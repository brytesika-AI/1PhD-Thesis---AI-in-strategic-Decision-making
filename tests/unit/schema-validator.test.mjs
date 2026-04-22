import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_OUTPUT_SCHEMAS,
  enforceJSON,
  safeToolExecution,
  safeTool,
  validateSchema,
  validateToolResult
} from "../../utils/schema-validator.js";
import { listToolDefinitions, runTool, tools } from "../../packages/skills/index.js";
import { MockKV, aiAlways } from "../helpers/mock-cloudflare.mjs";

test("enforceJSON parses objects, strings, nested JSON strings, and fenced JSON", async () => {
  assert.deepEqual(await enforceJSON({ ok: true }), { ok: true });
  assert.deepEqual(await enforceJSON('{"ok":true}'), { ok: true });
  assert.deepEqual(await enforceJSON('"{\\"ok\\":true}"'), { ok: true });
  assert.deepEqual(await enforceJSON('```json\n{"ok":true}\n```'), { ok: true });
});

test("enforceJSON retries invalid object stringification and falls back safely", async () => {
  let attempts = 0;
  const parsed = await enforceJSON("[object Object]", {
    attempts: 3,
    fallback: { recovered: true },
    retryLLM: async () => {
      attempts += 1;
      return attempts === 1 ? "still invalid" : '{"recovered":true}';
    }
  });

  assert.deepEqual(parsed, { recovered: true });
  assert.equal(attempts, 2);
});

test("schema validation fails missing fields and wrong types", () => {
  assert.throws(
    () => validateSchema({ confidence: "high" }, { required: { confidence: "number", evidence: "object" } }, { toolName: "gather_evidence" }),
    /missing|required|type/
  );
  assert.doesNotThrow(() => validateSchema({ confidence: 0.8, evidence: {} }, { required: { confidence: "number", evidence: "object" } }));
});

test("all tool definitions declare output schemas", () => {
  const definitions = listToolDefinitions();
  assert.ok(definitions.length >= 20);
  for (const definition of definitions) {
    assert.ok(definition.output_schema, `${definition.name} missing output_schema`);
    assert.ok(TOOL_OUTPUT_SCHEMAS[definition.name], `${definition.name} missing central schema`);
  }
});

test("tool outputs are JSON objects that satisfy schemas", async () => {
  for (const toolName of Object.keys(tools)) {
    const result = await runTool(toolName, {
      text: "Cloud migration with load shedding + POPIA risk",
      context: {
        case_id: `UNIT-${toolName}`,
        user_goal: "Cloud migration with load shedding + POPIA risk",
        verification_chain: { devil_advocate_validated: true }
      },
      llm: null
    });
    assert.equal(typeof result, "object", `${toolName} returned non-object`);
    assert.equal(Array.isArray(result), false, `${toolName} returned array`);
    validateToolResult(toolName, result);
  }
});

test("safeToolExecution recovers from invalid JSON and validates fallback", async () => {
  const result = await safeToolExecution(
    async () => "[object Object]",
    {},
    {
      toolName: "generate_options",
      fallback: {
        options: [{ name: "Fallback", description: "Structured recovery", risk: "low" }],
        confidence: 0.7
      }
    }
  );

  assert.equal(result.options[0].name, "Fallback");
  assert.equal(result.confidence, 0.7);
});

test("safeTool returns structured error objects on invalid tool output", async () => {
  const result = await safeTool(async () => "[object Object]", {});

  assert.equal(result.error, true);
  assert.match(result.message, /Invalid JSON/);
});

test("runTool survives malformed LLM responses through enforced fallback", async () => {
  const result = await runTool("gather_evidence", {
    text: "Cloud migration with load shedding + POPIA risk",
    context: { case_id: "UNIT-BAD-JSON" },
    llm: aiAlways("[object Object]")
  });

  assert.ok(result.evidence);
  assert.equal(typeof result.confidence, "number");
  validateToolResult("gather_evidence", result);
});

test("runTool cache uses short KV keys even with large state payloads", async () => {
  const cache = new MockKV();
  const hugeContext = {
    case_id: "UNIT-KV",
    current_stage: 1,
    evidence_bundle: { notes: "x".repeat(12000) },
    shared_memory: { episodic: Array.from({ length: 20 }, (_, index) => ({ index, content: "y".repeat(1000) })) }
  };

  const result = await runTool("generate_options", {
    text: "Cloud migration with load shedding + POPIA risk",
    context: hugeContext,
    llm: null,
    cache
  });

  assert.ok(result.options.length >= 1);
  for (const key of cache.values.keys()) {
    assert.ok(new TextEncoder().encode(key).length < 512, `KV key too long: ${key.length}`);
  }
});

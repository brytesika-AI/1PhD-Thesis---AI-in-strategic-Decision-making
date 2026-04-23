const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const CLOUDFLARE_DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const OPENAI_TASK_MODELS = {
  planning: "gpt-4o",
  extraction: "gpt-4o-mini",
  evaluation: "gpt-4o-mini"
};

const CLOUDFLARE_TASK_MODELS = {
  planning: CLOUDFLARE_DEFAULT_MODEL,
  extraction: "@cf/meta/llama-3.1-8b-instruct-fast",
  evaluation: CLOUDFLARE_DEFAULT_MODEL
};

function modelForTask(task = "extraction", env = {}) {
  const provider = String(env.LLM_PROVIDER || (env.OPENAI_API_KEY ? "openai" : "cloudflare")).toLowerCase();
  const upperTask = String(task || "extraction").toUpperCase();
  const explicit = env[`LLM_${upperTask}_MODEL`];
  if (explicit) return explicit;
  if (provider === "openai") return OPENAI_TASK_MODELS[task] || OPENAI_TASK_MODELS.extraction;
  return CLOUDFLARE_TASK_MODELS[task] || env.AI_MODEL || CLOUDFLARE_DEFAULT_MODEL;
}

function useOpenAI(model, env = {}) {
  return Boolean(env.OPENAI_API_KEY && /^gpt-|^o\d|^chatgpt-/i.test(String(model)));
}

function responseText(result) {
  if (typeof result === "string") return result;
  if (result?.response) return result.response;
  if (result?.choices?.[0]?.message?.content) return result.choices[0].message.content;
  return JSON.stringify(result ?? "");
}

async function callOpenAI(model, prompt, temperature, env = {}) {
  const response = await fetch(env.OPENAI_CHAT_COMPLETIONS_URL || OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are the AI-SRF outcome engine. Return only valid JSON. No markdown, no prose outside JSON."
        },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }
  return responseText(await response.json());
}

async function callCloudflareAI(model, prompt, temperature, env = {}) {
  if (!env.AI?.run) {
    throw new Error("No LLM binding available. Configure OPENAI_API_KEY or Cloudflare Workers AI binding.");
  }
  const result = await env.AI.run(model, {
    messages: [
      {
        role: "system",
        content: "You are the AI-SRF outcome engine. Return only valid JSON. No markdown, no prose outside JSON."
      },
      { role: "user", content: prompt }
    ],
    temperature,
    max_tokens: Number(env.LLM_MAX_TOKENS || 1200)
  });
  return responseText(result);
}

export async function fetchLLM(model, prompt, temperature = 0, env = {}) {
  if (useOpenAI(model, env)) {
    return callOpenAI(model, prompt, temperature, env);
  }
  return callCloudflareAI(model, prompt, temperature, env);
}

export async function callLLM({ task, prompt, temperature = 0, env = {} }) {
  const model = modelForTask(task, env);
  return fetchLLM(model, prompt, temperature, env);
}

export function selectedLLMModel(task, env = {}) {
  return modelForTask(task, env);
}

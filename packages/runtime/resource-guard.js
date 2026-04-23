const DEFAULT_LIMITS = {
  maxSubrequests: 90,
  maxToolCalls: 24,
  maxStateBytes: 750000,
  maxCacheValueBytes: 131072,
  maxRequestBytes: 131072
};

export class ResourceLimitError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ResourceLimitError";
    this.error_category = "resource_limit";
    this.is_retriable = false;
    this.suggestion = "Terminate the loop and escalate to a human operator with the replay trace.";
    this.details = details;
  }
}

export function byteSize(value) {
  try {
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value ?? null)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function createResourceGuard(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || options) };
  const counters = {
    subrequests: 0,
    tool_calls: 0,
    state_bytes: 0,
    cache_value_bytes: 0
  };

  function snapshot(extra = {}) {
    return {
      trace_id: options.traceId || options.trace_id || null,
      limits,
      counters: { ...counters },
      ...extra
    };
  }

  function fail(message, extra = {}) {
    throw new ResourceLimitError(message, snapshot(extra));
  }

  return {
    limits,
    counters,
    snapshot,
    beforeSubrequest(kind, detail = {}) {
      counters.subrequests += 1;
      if (kind === "tool" || kind === "framework_tool") counters.tool_calls += 1;
      if (counters.subrequests > limits.maxSubrequests) {
        fail(`Subrequest budget exceeded: ${counters.subrequests}/${limits.maxSubrequests}.`, { kind, detail });
      }
      if (counters.tool_calls > limits.maxToolCalls) {
        fail(`Tool-call budget exceeded: ${counters.tool_calls}/${limits.maxToolCalls}.`, { kind, detail });
      }
      return snapshot({ kind, detail });
    },
    assertStateSize(label, value) {
      counters.state_bytes = byteSize(value);
      if (counters.state_bytes > limits.maxStateBytes) {
        fail(`State budget exceeded after ${label}: ${counters.state_bytes}/${limits.maxStateBytes} bytes.`, { label });
      }
      return counters.state_bytes;
    },
    assertCacheValue(label, value) {
      counters.cache_value_bytes = byteSize(value);
      if (counters.cache_value_bytes > limits.maxCacheValueBytes) {
        fail(`Cache value budget exceeded for ${label}: ${counters.cache_value_bytes}/${limits.maxCacheValueBytes} bytes.`, { label });
      }
      return counters.cache_value_bytes;
    }
  };
}

export function isResourceLimitError(error = {}) {
  return error instanceof ResourceLimitError || error.error_category === "resource_limit";
}

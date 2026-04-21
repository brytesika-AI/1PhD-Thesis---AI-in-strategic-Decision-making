export function validateRuntimeConfig(config) {
  const runtime = config?.runtime;
  if (!runtime) {
    throw new Error("runtime config missing runtime root");
  }
  if (runtime.production_target !== "cloudflare") {
    throw new Error("AI-SRF production target must be cloudflare");
  }
  if (runtime.gateway_mode !== "control_plane") {
    throw new Error("Gateway must operate as the control plane");
  }
  if (runtime.engine_mode !== "stateful_agent_loop") {
    throw new Error("AI-SRF runtime must use the stateful agent loop engine");
  }
  if (runtime.routing?.allow_dynamic_agent_skips !== false) {
    throw new Error("Dynamic agent skips are disabled for governed AI-SRF routing");
  }
  if (runtime.sandbox_policy?.blocked_by_default !== true) {
    throw new Error("Sandbox policy must be blocked by default");
  }
  return runtime;
}

export function eventHooksFor(config, eventName) {
  const runtime = validateRuntimeConfig(config);
  return runtime.event_hooks?.[eventName] || [];
}

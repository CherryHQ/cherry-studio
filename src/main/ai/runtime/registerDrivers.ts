import { ClaudeCodeRuntimeDriver } from './claudeCode'
import { PiRuntimeDriver } from './pi/PiRuntimeDriver'
import { runtimeDriverRegistry } from './registry'
import { StellaRuntimeDriver } from './stella/StellaRuntimeDriver'

/**
 * Register every built-in AI runtime driver into the shared registry.
 *
 * Called once from `AgentSessionRuntimeService.onInit` — a controlled
 * lifecycle point (WhenReady phase, before any agent session runs) — rather
 * than as an import-time side effect, so the registry is populated
 * deterministically. Every `AgentType` must be registered here —
 * `registerDrivers.test.ts` enforces the pairing with
 * `AGENT_RUNTIME_CAPABILITIES`.
 */
export function registerRuntimeDrivers(): void {
  runtimeDriverRegistry.register(new ClaudeCodeRuntimeDriver())
  runtimeDriverRegistry.register(new PiRuntimeDriver())
  runtimeDriverRegistry.register(new StellaRuntimeDriver())
}

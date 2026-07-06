import { ClaudeCodeRuntimeDriver } from './claudeCode'
import { runtimeDriverRegistry } from './registry'

/**
 * Register every built-in AI runtime driver into the shared registry.
 *
 * Called once from `AgentSessionRuntimeService.onInit` — a controlled
 * lifecycle point (WhenReady phase, before any agent session runs) — rather
 * than as an import-time side effect. This keeps the registry populated
 * deterministically and lets `runtime/index.ts` stay a pure re-export barrel.
 */
export function registerRuntimeDrivers(): void {
  runtimeDriverRegistry.register(new ClaudeCodeRuntimeDriver())
}

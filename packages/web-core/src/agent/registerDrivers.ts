// Browser `registerDrivers.ts`: Claude Code and Pi need Node and a shell, so the browser driver runs every agent.
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'

import { BrowserAgentDriver } from './BrowserAgentDriver'

export function registerRuntimeDrivers(): void {
  runtimeDriverRegistry.register(new BrowserAgentDriver())
}

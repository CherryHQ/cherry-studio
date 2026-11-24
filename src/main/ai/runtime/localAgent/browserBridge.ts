import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { type LocalAgentConfiguration, resolveLocalAgentBrowserControl } from '@shared/ai/localAgent'

import { type AcpPermissionToolLike, classifyAcpToolKind } from './acpPermissionPolicy'
import type { LocalAgentBrowserLease } from './LocalAgentMcpBridgeService'

export const LOCAL_AGENT_AUTOMATION_SERVER_NAME = 'automation'
const PRESETS_WITHOUT_ACP_SESSION_MCP = new Set(['openclaw'])
const INJECTED_ACP_AUTOMATION_TOOL_PATTERN =
  /^(?:mcp__automation__(?:js|reset)|mcp_automation\.(?:js|reset)|automation(?:__|\s*:\s*|\/|-|_)(?:js|reset)|(?:mcp:)?poolside__agent__automation(?::|__)(?:js|reset))$/i

export function isHostBrowserControlAllowed(
  config: Pick<LocalAgentConfiguration, 'presetId' | 'browserControl'>
): boolean {
  if (resolveLocalAgentBrowserControl(config) === 'disabled') return false
  return Boolean(application.getExisting('PreferenceService')?.get('app.browser.agent_control.enabled'))
}

export function isInjectedAcpAutomationTool(tool: AcpPermissionToolLike): boolean {
  if (classifyAcpToolKind(tool) !== 'other') return false
  const identifier = (tool.name ?? tool.title ?? '').trim()
  if (INJECTED_ACP_AUTOMATION_TOOL_PATTERN.test(identifier)) return true
  // DeferExecuteTool (CodeBuddy Code) wraps the actual MCP tool name in rawInput.toolName.
  if (
    identifier === 'DeferExecuteTool' &&
    tool.rawInput !== null &&
    typeof tool.rawInput === 'object' &&
    !Array.isArray(tool.rawInput)
  ) {
    const deferredName = (tool.rawInput as Record<string, unknown>).toolName
    return typeof deferredName === 'string' && INJECTED_ACP_AUTOMATION_TOOL_PATTERN.test(deferredName.trim())
  }
  return false
}

export async function acquireLocalAgentBrowserLease({
  sessionId,
  agentId,
  config,
  headless,
  signal,
  isReadOnly
}: {
  sessionId: string
  agentId: string
  config: Pick<LocalAgentConfiguration, 'presetId' | 'browserControl'>
  headless: boolean
  signal: AbortSignal
  isReadOnly: () => boolean
}): Promise<LocalAgentBrowserLease | undefined> {
  if (headless || !agentId) return undefined
  // OpenClaw ACP bridge rejects any non-empty per-session mcpServers in session/new and session/load.
  if (config.presetId && PRESETS_WITHOUT_ACP_SESSION_MCP.has(config.presetId)) return undefined
  const mode = resolveLocalAgentBrowserControl(config)
  if (mode === 'disabled') return undefined

  const bridge = application.getExisting('LocalAgentMcpBridgeService')
  if (!bridge) return undefined
  if (bridge instanceof BaseService && !bridge.isReady) return undefined

  const lease = await bridge.issueBrowserLease({
    sessionId,
    agentId,
    isBrowserAllowed: () => resolveLocalAgentBrowserControl(config) !== 'disabled',
    isReadOnly: () => resolveLocalAgentBrowserControl(config) === 'readonly' || isReadOnly()
  })
  if (signal.aborted) {
    await lease.dispose().catch(() => {})
    signal.throwIfAborted()
  }
  return lease
}

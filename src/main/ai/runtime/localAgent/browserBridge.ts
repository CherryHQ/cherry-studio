import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { type LocalAgentConfiguration, resolveLocalAgentBrowserControl } from '@shared/ai/localAgent'

import { type AcpPermissionToolLike, classifyAcpToolKind } from './acpPermissionPolicy'
import { acpPreset } from './acpPresets'
import type { LocalAgentBrowserLease } from './LocalAgentMcpBridgeService'

export const LOCAL_AGENT_AUTOMATION_SERVER_NAME = 'automation'
const INJECTED_ACP_AUTOMATION_TOOL_PATTERN =
  /^(?:mcp__automation__(?:js|reset)|mcp_automation\.(?:js|reset)|automation(?:__|\s*:\s*|\/|-|_)(?:js|reset))$/i

export function isHostBrowserControlAllowed(
  config: Pick<LocalAgentConfiguration, 'presetId' | 'browserControl'>
): boolean {
  if (resolveLocalAgentBrowserControl(config) === 'disabled') return false
  return Boolean(application.getExisting('PreferenceService')?.get('app.browser.agent_control.enabled'))
}

export function isInjectedAcpAutomationTool(tool: AcpPermissionToolLike, presetId: string | undefined): boolean {
  if (classifyAcpToolKind(tool) !== 'other') return false
  const name = (tool.name ?? tool.title ?? '').trim()
  if (INJECTED_ACP_AUTOMATION_TOOL_PATTERN.test(name)) return true
  const native = acpPreset(presetId)?.automationName?.(name, tool.rawInput)
  return !!native && INJECTED_ACP_AUTOMATION_TOOL_PATTERN.test(native)
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
  if (acpPreset(config.presetId)?.sessionMcp === 'unsupported') return undefined
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

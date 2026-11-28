import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { type LocalAgentConfiguration, resolveLocalAgentBrowserControl } from '@shared/ai/localAgent'

import type { LocalAgentBrowserLease } from './LocalAgentMcpBridgeService'

export const LOCAL_AGENT_AUTOMATION_SERVER_NAME = 'automation'
export function isHostBrowserControlAllowed(
  config: Pick<LocalAgentConfiguration, 'presetId' | 'browserControl'>
): boolean {
  if (resolveLocalAgentBrowserControl(config) === 'disabled') return false
  return Boolean(application.getExisting('PreferenceService')?.get('app.browser.agent_control.enabled'))
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

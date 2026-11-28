import { setImmediate } from 'node:timers/promises'

import { jsonModelField } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

export const openCodeModelProfile = jsonModelField('opencode-config', 'model')
export const kiloModelProfile = jsonModelField('kilo-config', 'model')

export const openCodeAcpAdapter: AcpHarnessAdapter = {
  bind({ agent, sessionId, initializeMetadata }) {
    const steering = initializeMetadata?.steering
    if (!steering || typeof steering !== 'object' || !('supported' in steering) || steering.supported !== true)
      return {}

    let pending: { messageId?: string; outcome?: 'completed' | 'failed' } | undefined
    return {
      steer: {
        whenIdle: 'reject',
        async submit({ inputId, content }) {
          try {
            const response: unknown = await agent.request('_session/steering', { sessionId, prompt: content })
            if (response && typeof response === 'object' && 'outcome' in response) {
              if (response.outcome === 'injected') return { status: 'acknowledged', inputId, facts: ['accepted'] }
              if (response.outcome === 'promptRequired')
                return {
                  status: 'rejected',
                  inputId,
                  error: { operation: 'steer', code: 'no-active-turn', message: 'OpenCode requires a new prompt' }
                }
            }
          } catch (error) {
            if (error instanceof Error && 'code' in error && (error.code === -32601 || error.code === -32602))
              return {
                status: 'rejected',
                inputId,
                error: { operation: 'steer', code: 'refused', message: error.message }
              }
          }
          return {
            status: 'unknown',
            inputId,
            error: { operation: 'steer', code: 'missing-receipt', message: 'OpenCode did not confirm steer admission' }
          }
        }
      },
      observeUpdate(update) {
        if (!pending) return
        const marker = update._meta?.['opencode/compaction']
        if (
          !marker ||
          typeof marker !== 'object' ||
          !('reason' in marker) ||
          marker.reason !== 'manual' ||
          !('messageId' in marker) ||
          typeof marker.messageId !== 'string' ||
          !('status' in marker)
        )
          return
        if (marker.status === 'started') pending.messageId ??= marker.messageId
        if (pending.messageId === marker.messageId && (marker.status === 'completed' || marker.status === 'failed'))
          pending.outcome ??= marker.status
      },
      async compact() {
        const operation: NonNullable<typeof pending> = {}
        pending = operation
        try {
          await agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/compact' }] })
          // The ACP router can yield between notifications and the prompt response.
          await setImmediate()
          if (operation.outcome === 'completed') return { status: 'confirmed', value: undefined }
          if (operation.outcome === 'failed')
            return {
              status: 'rejected',
              error: { operation: 'compact', code: 'failed', message: 'OpenCode reported failed compaction' }
            }
          return {
            status: 'unknown',
            error: { operation: 'compact', code: 'missing-receipt', message: 'OpenCode did not confirm compaction' }
          }
        } catch (error) {
          return {
            status: 'unknown',
            error: {
              operation: 'compact',
              code: 'missing-receipt',
              message: error instanceof Error ? error.message : 'OpenCode did not confirm compaction'
            }
          }
        } finally {
          pending = undefined
        }
      }
    }
  }
}

export { readOpenCodeGoSubscriptionUsage } from './accountUsage'

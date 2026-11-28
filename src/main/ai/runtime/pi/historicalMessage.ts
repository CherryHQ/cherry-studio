import type { SessionManager } from '@earendil-works/pi-coding-agent'

/** Historical records are inert text, never native executable tool calls. */
export function appendHistoricalMessage(
  manager: SessionManager,
  row: { role: string; createdAt: number },
  text: string
): void {
  if (!text) return
  if (row.role === 'user') {
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: row.createdAt })
  } else if (row.role === 'assistant') {
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: row.createdAt,
      api: 'openai-completions',
      provider: 'cherry-history',
      model: 'imported-history',
      stopReason: 'stop',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    })
  } else {
    manager.appendCustomMessageEntry('cherry-history', text, false)
  }
}

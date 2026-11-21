import { describe, expect, it, vi } from 'vitest'

import { activeAgentDraftEditorManager, type ActiveAgentDraftEditor } from '../ActiveAgentDraftEditorManager'

const editor = (): ActiveAgentDraftEditor => ({ owner: vi.fn(), isShowing: () => true, clearSubmitted: vi.fn() })

describe('ActiveAgentDraftEditorManager', () => {
  it('keeps replacement registration during stale cleanup and isolates draft keys', async () => {
    const secondConsumer = (await import('../ActiveAgentDraftEditorManager')).activeAgentDraftEditorManager
    expect(secondConsumer).toBe(activeAgentDraftEditorManager)
    const first = editor()
    const replacement = editor()
    const other = editor()
    activeAgentDraftEditorManager.register('draft-a', first)
    activeAgentDraftEditorManager.register('draft-b', other)
    activeAgentDraftEditorManager.register('draft-a', replacement)
    activeAgentDraftEditorManager.unregister('draft-a', first)
    expect(secondConsumer.get('draft-a')).toBe(replacement)
    expect(secondConsumer.get('draft-b')).toBe(other)
    secondConsumer.unregister('draft-a', replacement)
    expect(activeAgentDraftEditorManager.get('draft-a')).toBeUndefined()
    expect(activeAgentDraftEditorManager.get('draft-b')).toBe(other)
    secondConsumer.unregister('draft-b', other)
  })
})

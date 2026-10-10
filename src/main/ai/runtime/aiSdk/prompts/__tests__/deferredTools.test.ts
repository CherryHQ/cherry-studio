import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import type { ToolEntry } from '../../../../tools/adapters/aiSdk/types'
import { getDeferredToolsSystemPrompt } from '../deferredTools'

const entry = (overrides: Partial<ToolEntry>): ToolEntry => ({
  name: 'mcp__gmail__send_0123456789abcdef0123',
  namespace: 'mcp:11111111-2222-3333-4444-555555555555',
  description: 'send mail',
  defer: 'auto',
  tool: {} as Tool,
  ...overrides
})

describe('getDeferredToolsSystemPrompt', () => {
  it('lists the namespace label instead of the opaque ownership key', () => {
    const prompt = getDeferredToolsSystemPrompt([entry({ namespaceLabel: 'mcp:Gmail' })])

    expect(prompt).toContain('<namespace name="mcp:Gmail" count="1"/>')
    expect(prompt).not.toContain('11111111-2222-3333-4444-555555555555')
  })

  it('falls back to the namespace when no label is set', () => {
    const prompt = getDeferredToolsSystemPrompt([entry({ name: 'web_search', namespace: 'web' })])

    expect(prompt).toContain('<namespace name="web" count="1"/>')
  })
})

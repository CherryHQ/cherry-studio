import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'

describe('tool response classification', () => {
  it('classifies an AI SDK dynamic image tool as builtin', () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'image-call',
      toolName: 'generate_image',
      state: 'output-available',
      input: { prompt: 'a cat' },
      output: [{ id: 'file-1', name: 'cat.png' }]
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.tool.type).toBe('builtin')
  })

  it('classifies Pi builtin metadata as provider execution', () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'pi-read',
      toolName: 'read',
      state: 'output-available',
      input: { path: '/workspace/file.md' },
      output: 'content',
      callProviderMetadata: {
        cherry: { transport: 'pi-agent', tool: { type: 'builtin', name: 'read' } }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.tool.type).toBe('provider')
  })
})

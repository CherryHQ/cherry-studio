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

// Provider history must not vanish just because its tool name is absent from the current runtime registry.
it('renders completed provider calls through the standard input/output tool card', async () => {
  const { render, screen } = await import('@testing-library/react')
  const { default: userEvent } = await import('@testing-library/user-event')
  const { default: MessageTools } = await import('../MessageTools')
  const response = buildToolResponseFromPart({
    type: 'dynamic-tool',
    toolName: 'deepseek_search',
    toolCallId: 'imported-search',
    state: 'output-available',
    input: { queries: ['Original question'] },
    output: { status: 'FINISHED', results: [], snippet: 'Original evidence' },
    callProviderMetadata: { cherry: { tool: { type: 'provider' } } }
  })
  if (!response || response.tool.type !== 'provider') throw new Error('Expected provider tool')
  render(<MessageTools toolResponse={response} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /deepseek_search/ }))
  expect(await screen.findByText(/Original question/)).toBeVisible()
  expect(screen.getByText('Original evidence')).toBeVisible()
  expect(screen.getByText('FINISHED')).toBeVisible()
  expect(screen.getByText('[]')).toBeVisible()
})

import { describe, expect, it } from 'vitest'

import { generatedImagesFromOutput, generatedImagesFromPart } from '../generateImageTool'

const images = [{ id: 'saved-file', name: 'result.png' }]
const envelope = { type: 'generated-images', images }
describe('generated image result references', () => {
  it.each([
    images,
    envelope,
    { content: [], structuredContent: envelope },
    { content: [], details: envelope },
    { content: envelope, metadata: { type: 'mcp', serverName: 'cherry-tools' } },
    { content: [{ type: 'text', text: JSON.stringify(envelope) }] },
    [{ type: 'text', text: JSON.stringify(envelope) }]
  ])('preserves file references across supported transport envelopes', (value) => {
    expect(generatedImagesFromOutput(value)).toEqual(images)
  })
  it('does not infer files from prose, unrelated tools or failed responses', () => {
    expect(generatedImagesFromOutput({ isError: true, structuredContent: envelope })).toEqual([])
    expect(generatedImagesFromOutput({ content: [{ type: 'text', text: 'saved-file result.png' }] })).toEqual([])
    expect(
      generatedImagesFromPart({
        type: 'dynamic-tool',
        toolName: 'unrelated',
        toolCallId: '1',
        state: 'output-available',
        input: {},
        output: images
      })
    ).toEqual([])
  })
})

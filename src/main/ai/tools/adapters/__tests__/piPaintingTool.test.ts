import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { createPiCodeModeTools } from '@main/ai/runtime/pi/piCodeMode'
import { PiStreamAdapter } from '@main/ai/runtime/pi/piStreamAdapter'
import { generatedImagesFromPart } from '@shared/ai/generateImageTool'
import { PI_TOOL_CALL_TOOL_NAME, PI_TOOL_EXEC_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import type { CherryUIMessageChunk } from '@shared/data/types/message'

import { withPiPaintingResults } from '../piPaintingTool'

const name = 'mcp__cherry-tools__generate_image'
const images = { type: 'generated-images' as const, images: [{ id: 'saved-image', name: 'picture.png' }] }
function paintingTool(): ToolDefinition & { outputSchema: unknown } {
  return {
    name,
    label: 'Generate image',
    description: 'Generate image',
    parameters: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    execute: async () => ({ content: [{ type: 'text', text: JSON.stringify(images) }], details: images })
  }
}

describe('Pi painting result delivery', () => {
  it.each(['return "done"', 'throw new Error("later script failure")'])(
    'publishes the completed file with its original call identity even when the script ends with %s',
    async (ending) => {
      const chunks: CherryUIMessageChunk[] = []
      const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) })
      const tools = createPiCodeModeTools(
        withPiPaintingResults([paintingTool()], (event) => adapter.handleEvent(event)),
        () => false,
        async () => undefined
      )
      const exec = tools.find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!
      const run = exec.execute(
        'outer',
        { code: `await tools.invoke('${name}', {}); ${ending}` },
        undefined,
        undefined,
        {} as never
      )
      if (ending.startsWith('throw')) await expect(run).rejects.toThrow('later script failure')
      else await run
      const output = chunks.find((chunk) => chunk.type === 'tool-output-available')!
      expect(output.output).toEqual({ content: [{ type: 'text', text: JSON.stringify(images) }], details: images })
      expect(output.toolCallId).toMatch(/^outer::exec::/)
      expect(
        generatedImagesFromPart({
          type: 'dynamic-tool',
          toolName: name,
          toolCallId: output.toolCallId,
          state: 'output-available',
          input: {},
          output: output.output
        })
      ).toEqual(images.images)
    }
  )

  it('preserves separate identities for multiple nested generations and tool_call', async () => {
    const chunks: CherryUIMessageChunk[] = []
    const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) })
    const tools = createPiCodeModeTools(
      withPiPaintingResults([paintingTool()], (event) => adapter.handleEvent(event)),
      () => false,
      async () => undefined
    )
    await tools
      .find((tool) => tool.name === PI_TOOL_EXEC_TOOL_NAME)!
      .execute(
        'batch',
        {
          code: `await tools.invoke('${name}', {}); await tools.invoke('${name}', {}); return 'done'`
        },
        undefined,
        undefined,
        {} as never
      )
    await tools
      .find((tool) => tool.name === PI_TOOL_CALL_TOOL_NAME)!
      .execute(
        'single',
        {
          name,
          params: {}
        },
        undefined,
        undefined,
        {} as never
      )
    const outputs = chunks.filter((chunk) => chunk.type === 'tool-output-available')
    expect(outputs).toHaveLength(3)
    expect(new Set(outputs.map((output) => output.toolCallId)).size).toBe(3)
    expect(outputs[2].toolCallId).toBe('single::call')
    for (const output of outputs) {
      expect(
        generatedImagesFromPart({
          type: 'dynamic-tool',
          toolName: name,
          toolCallId: output.toolCallId,
          state: 'output-available',
          input: {},
          output: output.output
        })
      ).toEqual(images.images)
    }
  })
})

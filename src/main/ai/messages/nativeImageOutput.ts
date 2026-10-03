import type { UIMessageChunk } from 'ai'
import { fileTypeFromBuffer } from 'file-type'

import { application } from '@application'
import { messageArtifactRetentionService } from '@data/services/MessageArtifactRetentionService'
import { NATIVE_IMAGE_TOOL_NAME, type NativeImageOutput } from '@shared/ai/nativeImageGeneration'
import { createInternalEntryInputSchema } from '@shared/ipc/schemas/file'

/** Move the terminal provider image to FileManager before it reaches persistence or transport. */
export async function storeNativeImageOutput(output: unknown, messageId: string): Promise<NativeImageOutput> {
  if (
    typeof output !== 'object' ||
    output === null ||
    !('result' in output) ||
    typeof output.result !== 'string' ||
    !output.result
  ) {
    throw new Error('Native image generation returned no image.')
  }
  const bytes = Buffer.from(output.result, 'base64')
  const fileType = await fileTypeFromBuffer(bytes)
  if (!fileType?.mime.startsWith('image/')) throw new Error('Native image generation returned invalid image data.')
  const entry = await application.get('FileManager').createInternalEntry(
    createInternalEntryInputSchema.parse({
      source: 'bytes',
      data: bytes,
      ext: fileType.ext,
      name: 'Grok image',
      cleanupPolicy: 'delete_when_unreferenced'
    })
  )
  messageArtifactRetentionService.retainMessageArtifact(messageId, application.get('FileManager').retainEntry(entry.id))
  return {
    nativeImage: true,
    files: [{ id: entry.id, name: entry.name }],
    ...('prompt' in output && typeof output.prompt === 'string' ? { prompt: output.prompt } : {})
  }
}

export function createNativeImageOutputAdapter(messageId?: string) {
  const calls = new Set<string>()
  const outputs = new Map<string, NativeImageOutput>()
  return async (chunk: UIMessageChunk): Promise<UIMessageChunk> => {
    if (chunk.type === 'start') messageId = chunk.messageId
    if (chunk.type === 'tool-input-available' && chunk.providerExecuted && chunk.toolName === NATIVE_IMAGE_TOOL_NAME) {
      calls.add(chunk.toolCallId)
    }
    if (chunk.type !== 'tool-output-available' || !calls.has(chunk.toolCallId)) return chunk
    if (!messageId) throw new Error('Native image output requires an assistant message id.')
    let output = outputs.get(chunk.toolCallId)
    if (!output) {
      output = await storeNativeImageOutput(chunk.output, messageId)
      outputs.set(chunk.toolCallId, output)
    }
    return { ...chunk, output }
  }
}

export function withNativeImageOutput(
  stream: ReadableStream<UIMessageChunk>,
  messageId?: string
): ReadableStream<UIMessageChunk> {
  const adaptOutput = createNativeImageOutputAdapter(messageId)
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      async transform(chunk, controller) {
        controller.enqueue(await adaptOutput(chunk))
      }
    })
  )
}

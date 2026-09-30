import { fileTypeFromBuffer } from 'file-type'

import { application } from '@application'
import type { NativeImageOutput } from '@shared/ai/nativeImageGeneration'
import { createInternalEntryInputSchema } from '@shared/ipc/schemas/file'

/** Move the terminal provider image to FileManager before it reaches persistence or transport. */
export async function storeNativeImageOutput(output: unknown): Promise<NativeImageOutput> {
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
  return {
    nativeImage: true,
    files: [{ id: entry.id, name: entry.name }],
    ...('prompt' in output && typeof output.prompt === 'string' ? { prompt: output.prompt } : {})
  }
}

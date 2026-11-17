import { createHash, randomUUID } from 'node:crypto'

import { ContentHashSchema } from '@shared/data/types/file'
import { fileEditRequestSchemas } from '@shared/ipc/schemas/fileEdit'
import { FileVersionSchema } from '@shared/types/file'

interface ReadFixture {
  content: Uint8Array
  version: { mtime: number; size: number }
}
export function createEditTransport(
  read: (route: string, input: unknown) => Promise<ReadFixture | { mtime: number; size: number }>
) {
  const paths = new Map<string, string>()
  const baseline = (data: Uint8Array, version: { mtime: number; size: number }) => ({
    version,
    contentHash: ContentHashSchema.parse(`sha256:${createHash('sha256').update(data).digest('hex')}`)
  })
  return async (route: string, input: unknown): Promise<unknown> => {
    if (route === 'file.edit.open') {
      const { handle } = fileEditRequestSchemas[route].input.parse(input)
      if (handle.kind !== 'path') throw new Error('Path fixture required')
      const editId = randomUUID()
      paths.set(editId, handle.path)
      return { editId }
    }
    if (route === 'file.edit.close') {
      paths.delete(fileEditRequestSchemas[route].input.parse(input).editId)
      return undefined
    }
    if (route === 'file.edit.read') {
      const { editId } = fileEditRequestSchemas[route].input.parse(input)
      const result = await read(route, { editId, path: paths.get(editId) })
      if (!('content' in result)) throw new Error('Missing read fixture')
      return { data: result.content, baseline: baseline(result.content, result.version) }
    }
    if (route === 'file.edit.write') {
      const wire =
        input && typeof input === 'object' && 'data' in input && ArrayBuffer.isView(input.data)
          ? { ...input, data: new Uint8Array(input.data.buffer, input.data.byteOffset, input.data.byteLength) }
          : input
      const request = fileEditRequestSchemas[route].input.parse(wire)
      const version = FileVersionSchema.parse(await read(route, request))
      return { baseline: baseline(request.data, version), metadataRecoveryPending: false }
    }
    return read(route, input)
  }
}

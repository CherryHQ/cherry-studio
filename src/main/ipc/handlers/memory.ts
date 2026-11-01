import { application } from '@application'
import { editorMemoryAuthority } from '@main/ai/memory/memoryAuthority'
import {
  MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
  MEMORY_WARNING_BYTES,
  MEMORY_WARNING_LINES,
  MemoryError
} from '@main/ai/memory/memoryFiles'
import type { MemoryApproval } from '@main/ai/memory/MemoryStore'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { memoryErrorCodes } from '@shared/ipc/errors/memory'
import type { memoryRequestSchemas } from '@shared/ipc/schemas/memory'
import type { IpcHandlersFor } from '@shared/ipc/types'

const owner = () => application.get('MemoryEditorService')
const confirmed: MemoryApproval = async () => () => undefined

async function operation<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new IpcError(memoryErrorCodes.OPERATION_FAILED, 'Memory operation failed', {
      reason: error instanceof MemoryError ? error.code : 'unavailable'
    })
  }
}

export const memoryHandlers: IpcHandlersFor<typeof memoryRequestSchemas> = {
  'memory.dreaming.status': (scope, { senderId }) =>
    operation(() => {
      editorMemoryAuthority(senderId, scope).assertAuthorized()
      return application.get('MemoryDreamingService').status(scope)
    }),
  'memory.dreaming.request': (scope, { senderId }) =>
    operation(() => {
      editorMemoryAuthority(senderId, scope).assertAuthorized()
      application.get('MemoryDreamingService').request(scope)
    }),
  'memory.dreaming.cancel': (scope, { senderId }) =>
    operation(() => {
      editorMemoryAuthority(senderId, scope).assertAuthorized()
      application.get('MemoryDreamingService').cancel(scope)
    }),
  'memory.editor.open': (scope, { senderId }) =>
    operation(() => ({
      editorId: owner().open(senderId, scope),
      maxBytes: MEMORY_MAX_BYTES,
      maxLines: MEMORY_MAX_LINES,
      warningBytes: MEMORY_WARNING_BYTES,
      warningLines: MEMORY_WARNING_LINES
    })),
  'memory.editor.close': ({ editorId }, { senderId }) => operation(() => owner().close(senderId, editorId)),
  'memory.file.list': ({ editorId }, { senderId }) => operation(() => owner().get(senderId, editorId).list()),
  'memory.file.read': ({ editorId, path }, { senderId }) => operation(() => owner().get(senderId, editorId).read(path)),
  'memory.file.write': ({ editorId, receipt, content }, { senderId }) =>
    operation(() =>
      owner()
        .get(senderId, editorId)
        .commit([{ kind: 'write', receipt, content }], confirmed)
    ),
  'memory.file.delete': ({ editorId, receipt }, { senderId }) =>
    operation(() =>
      owner()
        .get(senderId, editorId)
        .commit([{ kind: 'delete', receipt }], confirmed)
    ),
  'memory.file.rename': ({ editorId, receipt, destinationReceipt }, { senderId }) =>
    operation(() =>
      owner()
        .get(senderId, editorId)
        .commit([{ kind: 'rename', receipt, destinationReceipt }], confirmed)
    ),
  'memory.clear.preview': ({ editorId }, { senderId }) =>
    operation(() => owner().get(senderId, editorId).previewClear()),
  'memory.clear.confirm': ({ editorId, token }, { senderId }) =>
    operation(() => owner().get(senderId, editorId).clear(token, confirmed)),
  'memory.recovery.preview': ({ editorId }, { senderId }) =>
    operation(() => owner().get(senderId, editorId).previewRecovery()),
  'memory.recovery.confirm': ({ editorId, token }, { senderId }) =>
    operation(() => owner().get(senderId, editorId).recover(token, confirmed))
}

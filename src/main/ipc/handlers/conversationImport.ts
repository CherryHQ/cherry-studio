import { application } from '@application'
import { ensureImportedSessionHistory } from '@main/ai/runtime/pi/importedSessionHistory'
import type { conversationImportRequestSchemas } from '@shared/ipc/schemas/conversationImport'
import type { IpcHandlersFor } from '@shared/ipc/types'

function owner(senderId: string | null): string {
  if (!senderId) throw new Error('window_required')
  return senderId
}
export const conversationImportHandlers: IpcHandlersFor<typeof conversationImportRequestSchemas> = {
  'conversation_import.discover': async (input, ctx) =>
    application.get('ConversationImportService').discover(owner(ctx.senderId), input.source, input.root),
  'conversation_import.preview': async (input, ctx) =>
    application
      .get('ConversationImportService')
      .preview(owner(ctx.senderId), input.scanId, input.targetAgentId, input.selections),
  'conversation_import.commit': async (input, ctx) =>
    application.get('ConversationImportService').commit(owner(ctx.senderId), input.previewId, input.refs),
  'conversation_import.cancel': async (_, ctx) =>
    application.get('ConversationImportService').cancel(owner(ctx.senderId)),
  'conversation_import.retry_initialization': async (input, ctx) => {
    owner(ctx.senderId)
    await ensureImportedSessionHistory(input.sessionId)
  }
}

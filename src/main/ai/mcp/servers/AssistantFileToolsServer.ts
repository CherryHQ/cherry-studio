import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'

import { loggerService } from '@logger'
import { listAgentSessionAttachments } from '@main/ai/messages/agentSessionAttachments'
import {
  READ_FILE_DESCRIPTION,
  readFile,
  readFileModelOutput
} from '@main/ai/tools/adapters/aiSdk/builtin/ReadFileTool'
import {
  MOVE_TO_TRASH_DESCRIPTION,
  MOVE_TO_TRASH_TOOL_NAME,
  moveToTrashInputSchema,
  moveWorkspaceItemToTrash
} from '@main/ai/tools/moveToTrash'
import {
  SAVE_ATTACHMENT_DESCRIPTION,
  SAVE_ATTACHMENT_TOOL_NAME,
  saveAttachmentInputSchema,
  saveAttachmentToWorkspace
} from '@main/ai/tools/saveAttachment'
import { isAbortError } from '@main/utils/error'
import { READ_FILE_TOOL_NAME, readFileInputSchema } from '@shared/ai/builtinTools'

const logger = loggerService.withContext('McpServer:AssistantFileTools')

interface AssistantFileToolContext {
  sessionId: string
  workspacePath: string
}

// Failures stay opaque to the model: they can carry attachment entry ids or absolute paths.
async function runTool(name: string, signal: AbortSignal, run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await run()
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error
    logger.error(`Tool error: ${name}`, error instanceof Error ? error : { error: String(error) })
    return { content: [{ type: 'text', text: 'Tool execution failed' }], isError: true }
  }
}

export function createAssistantFileToolsServer(context: AssistantFileToolContext): McpServer {
  const server = new McpServer({ name: 'assistant-files', version: '1.0.0' })

  server.registerTool(
    READ_FILE_TOOL_NAME,
    { description: READ_FILE_DESCRIPTION, inputSchema: readFileInputSchema },
    async (input, ctx) =>
      runTool(READ_FILE_TOOL_NAME, ctx.mcpReq.signal, async () => {
        const result = await readFile(
          input,
          { attachments: listAgentSessionAttachments(context.sessionId) },
          ctx.mcpReq.signal
        )
        const output = readFileModelOutput(result)
        if (output.type !== 'text') throw new Error('read_file returned an unexpected output type')
        return output.value
      })
  )

  server.registerTool(
    SAVE_ATTACHMENT_TOOL_NAME,
    { description: SAVE_ATTACHMENT_DESCRIPTION, inputSchema: saveAttachmentInputSchema },
    async (input, ctx) =>
      runTool(SAVE_ATTACHMENT_TOOL_NAME, ctx.mcpReq.signal, () =>
        saveAttachmentToWorkspace(
          context.workspacePath,
          input,
          listAgentSessionAttachments(context.sessionId),
          ctx.mcpReq.signal
        )
      )
  )

  server.registerTool(
    MOVE_TO_TRASH_TOOL_NAME,
    { description: MOVE_TO_TRASH_DESCRIPTION, inputSchema: moveToTrashInputSchema },
    async (input, ctx) =>
      runTool(MOVE_TO_TRASH_TOOL_NAME, ctx.mcpReq.signal, () =>
        moveWorkspaceItemToTrash(context.workspacePath, input, ctx.mcpReq.signal)
      )
  )

  return server
}

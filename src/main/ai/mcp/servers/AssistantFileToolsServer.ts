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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { READ_FILE_TOOL_NAME, readFileInputSchema } from '@shared/ai/builtinTools'
import * as z from 'zod'

const logger = loggerService.withContext('McpServer:AssistantFileTools')

interface AssistantFileToolContext {
  sessionId: string
  workspacePath: string
}

interface AssistantFileToolHandler {
  description: string
  inputSchema: z.ZodType
  run: (args: unknown, signal: AbortSignal) => Promise<unknown>
}

function toTool(name: string, handler: AssistantFileToolHandler): Tool {
  const inputSchema = z.toJSONSchema(handler.inputSchema) as Record<string, unknown>
  delete inputSchema.$schema
  return { name, description: handler.description, inputSchema: inputSchema as Tool['inputSchema'] }
}

export class AssistantFileToolsServer {
  public readonly mcpServer: McpServer
  private readonly handlers: Record<string, AssistantFileToolHandler>

  constructor(context: AssistantFileToolContext) {
    this.handlers = {
      [READ_FILE_TOOL_NAME]: {
        description: READ_FILE_DESCRIPTION,
        inputSchema: readFileInputSchema,
        run: async (args, signal) => {
          const input = readFileInputSchema.parse(args)
          const result = await readFile(input, { attachments: listAgentSessionAttachments(context.sessionId) }, signal)
          const output = readFileModelOutput(result)
          if (output.type !== 'text') throw new Error('read_file returned an unexpected output type')
          return output.value
        }
      },
      [SAVE_ATTACHMENT_TOOL_NAME]: {
        description: SAVE_ATTACHMENT_DESCRIPTION,
        inputSchema: saveAttachmentInputSchema,
        run: async (args, signal) =>
          saveAttachmentToWorkspace(
            context.workspacePath,
            saveAttachmentInputSchema.parse(args),
            listAgentSessionAttachments(context.sessionId),
            signal
          )
      },
      [MOVE_TO_TRASH_TOOL_NAME]: {
        description: MOVE_TO_TRASH_DESCRIPTION,
        inputSchema: moveToTrashInputSchema,
        run: async (args, signal) =>
          moveWorkspaceItemToTrash(context.workspacePath, moveToTrashInputSchema.parse(args), signal)
      }
    }

    this.mcpServer = new McpServer({ name: 'assistant-files', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.setupHandlers()
  }

  private setupHandlers(): void {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(this.handlers).map(([name, handler]) => toTool(name, handler))
    }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
      const handler = this.handlers[request.params.name]
      if (!handler) {
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true }
      }

      try {
        const value = await handler.run(request.params.arguments, extra.signal)
        return {
          content: [
            {
              type: 'text',
              text: typeof value === 'string' ? value : JSON.stringify(value)
            }
          ]
        }
      } catch (error) {
        if (extra.signal.aborted || isAbortError(error)) throw error
        logger.error(`Tool error: ${request.params.name}`, error instanceof Error ? error : { error: String(error) })
        return { content: [{ type: 'text', text: 'Error: Tool execution failed' }], isError: true }
      }
    })
  }
}

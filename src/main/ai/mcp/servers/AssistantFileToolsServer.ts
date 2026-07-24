import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { collectFileAttachments } from '@main/ai/messages/attachmentRouting'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import {
  EXPORT_OFFICE_DESCRIPTION,
  EXPORT_OFFICE_TOOL_NAME,
  exportOfficeArtifact,
  exportOfficeInputSchema
} from '@main/ai/tools/exportOffice'
import { READ_FILE_DESCRIPTION, readFile, readFileModelOutput } from '@main/ai/tools/fileLookup'
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
import { AGENT_SESSION_MESSAGES_MAX_LIMIT } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryUIMessage } from '@shared/data/types/message'
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

function listSessionAttachments(sessionId: string): FileAttachmentRef[] {
  const messages: CherryUIMessage[] = []
  let cursor: string | undefined

  do {
    const page = agentSessionMessageService.listSessionMessages(sessionId, {
      cursor,
      limit: AGENT_SESSION_MESSAGES_MAX_LIMIT
    })
    for (const message of page.items) {
      if (message.role !== 'user') continue
      messages.push({ id: message.id, role: 'user', parts: message.data.parts } as CherryUIMessage)
    }
    cursor = page.nextCursor
  } while (cursor)

  const attachments = collectFileAttachments(messages.reverse())
  return Array.from(new Map(attachments.map((attachment) => [attachment.fileEntryId, attachment])).values())
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
          const result = await readFile(input, { attachments: listSessionAttachments(context.sessionId) }, signal)
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
            listSessionAttachments(context.sessionId),
            signal
          )
      },
      [EXPORT_OFFICE_TOOL_NAME]: {
        description: EXPORT_OFFICE_DESCRIPTION,
        inputSchema: exportOfficeInputSchema,
        run: async (args, signal) =>
          exportOfficeArtifact(context.workspacePath, exportOfficeInputSchema.parse(args), signal)
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
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${request.params.name}`, { error: message })
        return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
      }
    })
  }
}

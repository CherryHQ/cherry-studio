import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import {
  deleteToolDefinition,
  editToolDefinition,
  globToolDefinition,
  grepToolDefinition,
  handleDeleteTool,
  handleEditTool,
  handleGlobTool,
  handleGrepTool,
  handleLsTool,
  handleReadTool,
  handleWriteTool,
  lsToolDefinition,
  readToolDefinition,
  writeToolDefinition
} from './tools'
import { logger } from './types'

export class FileSystemServer {
  public server: Server
  private allowedDirectories: string[]

  constructor(allowedDirs?: string[]) {
    // Allowed-directories enforcement has been removed. We accept args for backward compatibility,
    // but the server is always unrestricted.
    if (Array.isArray(allowedDirs) && allowedDirs.length > 0) {
      logger.info(
        `Ignoring allowed directories args; filesystem MCP server is unrestricted. Args: ${allowedDirs.join(', ')}`
      )
    } else {
      logger.info('No allowed directories configured; filesystem MCP server is unrestricted.')
    }

    this.allowedDirectories = []

    this.server = new Server(
      {
        name: 'filesystem-server',
        version: '2.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    this.initialize()
  }

  initialize() {
    // Register tool list handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          globToolDefinition,
          lsToolDefinition,
          grepToolDefinition,
          readToolDefinition,
          editToolDefinition,
          writeToolDefinition,
          deleteToolDefinition,
          {
            name: 'list_allowed_directories',
            description:
              'Returns the list of directories that this server is allowed to access. ' +
              'Use this to understand which directories are available before trying to access files.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        ]
      }
    })

    // Register tool call handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'glob':
            return await handleGlobTool(args, this.allowedDirectories)

          case 'ls':
            return await handleLsTool(args, this.allowedDirectories)

          case 'grep':
            return await handleGrepTool(args, this.allowedDirectories)

          case 'read':
            return await handleReadTool(args, this.allowedDirectories)

          case 'edit':
            return await handleEditTool(args, this.allowedDirectories)

          case 'write':
            return await handleWriteTool(args, this.allowedDirectories)

          case 'delete':
            return await handleDeleteTool(args, this.allowedDirectories)

          case 'list_allowed_directories':
            return {
              content: [
                {
                  type: 'text',
                  text:
                    this.allowedDirectories.length > 0
                      ? `Allowed directories:\n${this.allowedDirectories.join('\n')}`
                      : 'Allowed directories: unrestricted'
                }
              ]
            }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(`Tool execution error for ${request.params.name}:`, { error })
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}

export default FileSystemServer

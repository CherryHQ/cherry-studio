import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import fs from 'fs/promises'
import path from 'path'

import {
  deleteToolDefinition,
  globToolDefinition,
  grepToolDefinition,
  handleDeleteTool,
  handleGlobTool,
  handleGrepTool,
  handleLsTool,
  handleReadTool,
  handleWriteTool,
  lsToolDefinition,
  readToolDefinition,
  writeToolDefinition
} from './tools'
import { expandHome, logger, normalizePath } from './types'

export class FileSystemServer {
  public server: Server
  private allowedDirectories: string[]

  constructor(allowedDirs: string[]) {
    if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
      throw new Error('No allowed directories provided, please specify at least one directory in args')
    }

    this.allowedDirectories = allowedDirs.map((dir) => normalizePath(path.resolve(expandHome(dir))))

    // Validate that all directories exist and are accessible
    this.validateDirs().catch((error) => {
      logger.error('Error validating allowed directories:', error)
      throw new Error(`Error validating allowed directories: ${error}`)
    })

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

  async validateDirs() {
    // Validate that all directories exist and are accessible
    await Promise.all(
      this.allowedDirectories.map(async (dir) => {
        try {
          const stats = await fs.stat(expandHome(dir))
          if (!stats.isDirectory()) {
            logger.error(`Error: ${dir} is not a directory`)
            throw new Error(`Error: ${dir} is not a directory`)
          }
        } catch (error: any) {
          logger.error(`Error accessing directory ${dir}:`, error)
          throw new Error(`Error accessing directory ${dir}: ${error.message}`)
        }
      })
    )
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

          case 'write':
            return await handleWriteTool(args, this.allowedDirectories)

          case 'delete':
            return await handleDeleteTool(args, this.allowedDirectories)

          case 'list_allowed_directories':
            return {
              content: [
                {
                  type: 'text',
                  text: `Allowed directories:\n${this.allowedDirectories.join('\n')}`
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

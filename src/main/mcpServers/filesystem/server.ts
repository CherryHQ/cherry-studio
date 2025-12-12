import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

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
  private baseDir: string

  constructor() {
    const envRoot = process.env.WORKSPACE_ROOT
    if (envRoot && path.isAbsolute(envRoot)) {
      this.baseDir = envRoot
      logger.info(`Using WORKSPACE_ROOT for filesystem MCP baseDir: ${envRoot}`)
    } else {
      const userData = app.getPath('userData')
      this.baseDir = path.join(userData, 'workspace')
      logger.info(`Using default workspace for filesystem MCP baseDir: ${this.baseDir}`)
    }

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

  async initialize() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true })
    } catch (error) {
      logger.error('Failed to create filesystem MCP baseDir', { error, baseDir: this.baseDir })
    }

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
          deleteToolDefinition
        ]
      }
    })

    // Register tool call handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'glob':
            return await handleGlobTool(args, this.baseDir)

          case 'ls':
            return await handleLsTool(args, this.baseDir)

          case 'grep':
            return await handleGrepTool(args, this.baseDir)

          case 'read':
            return await handleReadTool(args, this.baseDir)

          case 'edit':
            return await handleEditTool(args, this.baseDir)

          case 'write':
            return await handleWriteTool(args, this.baseDir)

          case 'delete':
            return await handleDeleteTool(args, this.baseDir)

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

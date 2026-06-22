import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
import { expandHome, logger, normalizePath } from './types'

function resolveBaseDir(baseDir?: string): string {
  const expandedBaseDir = baseDir ? expandHome(baseDir) : undefined

  if (expandedBaseDir && path.isAbsolute(expandedBaseDir)) {
    const resolved = normalizePath(path.resolve(expandedBaseDir))
    logger.info(`Using provided baseDir for filesystem MCP: ${resolved}`)
    return resolved
  }

  const userData = app.getPath('userData')
  const fallback = path.join(userData, 'Data', 'Workspace')
  logger.info(`Using default workspace for filesystem MCP baseDir: ${fallback}`)
  return fallback
}

async function ensureBaseDir(baseDir: string) {
  try {
    await fs.mkdir(baseDir, { recursive: true })
  } catch (error) {
    logger.error('Failed to create filesystem MCP baseDir', { error, baseDir })
  }
}

function registerHandlers(server: Server, getBaseDir: () => string) {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
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
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const baseDir = getBaseDir()

    try {
      const { name, arguments: args } = request.params

      switch (name) {
        case 'glob':
          return await handleGlobTool(args, baseDir)

        case 'ls':
          return await handleLsTool(args, baseDir)

        case 'grep':
          return await handleGrepTool(args, baseDir)

        case 'read':
          return await handleReadTool(args, baseDir)

        case 'edit':
          return await handleEditTool(args, baseDir)

        case 'write':
          return await handleWriteTool(args, baseDir)

        case 'delete':
          return await handleDeleteTool(args, baseDir)

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

export class FileSystemServer {
  public server: Server
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
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

    registerHandlers(this.server, () => this.baseDir)
    void ensureBaseDir(this.baseDir)
  }
}

export class FileSystemSdkServer {
  public mcpServer: McpServer
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
    this.mcpServer = new McpServer(
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

    registerHandlers(this.mcpServer.server, () => this.baseDir)
    void ensureBaseDir(this.baseDir)
  }
}

export default FileSystemServer

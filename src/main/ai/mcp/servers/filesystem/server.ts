import fs from 'fs/promises'
import path from 'path'

import { McpServer } from '@modelcontextprotocol/server'

import { application } from '@application'

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

export class FileSystemServer {
  public server: McpServer
  private baseDir: string

  constructor(baseDir?: string) {
    const expandedBaseDir = baseDir ? expandHome(baseDir) : undefined

    if (expandedBaseDir && path.isAbsolute(expandedBaseDir)) {
      this.baseDir = normalizePath(path.resolve(expandedBaseDir))
      logger.info(`Using provided baseDir for filesystem MCP: ${this.baseDir}`)
    } else {
      this.baseDir = application.getPath('feature.mcp.workspace')
      logger.info(`Using default workspace for filesystem MCP baseDir: ${this.baseDir}`)
    }

    this.server = new McpServer({
      name: 'filesystem-server',
      version: '2.0.0'
    })

    this.registerHandlers()
    void this.ensureBaseDir()
  }

  private async ensureBaseDir() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true })
    } catch (error) {
      logger.error('Failed to create filesystem MCP baseDir', { error, baseDir: this.baseDir })
    }
  }

  private registerHandlers() {
    const baseDir = this.baseDir
    this.server.registerTool('glob', globToolDefinition, (args) => handleGlobTool(args, baseDir))
    this.server.registerTool('ls', lsToolDefinition, (args) => handleLsTool(args, baseDir))
    this.server.registerTool('grep', grepToolDefinition, (args) => handleGrepTool(args, baseDir))
    this.server.registerTool('read', readToolDefinition, (args) => handleReadTool(args, baseDir))
    this.server.registerTool('edit', editToolDefinition, (args) => handleEditTool(args, baseDir))
    this.server.registerTool('write', writeToolDefinition, (args) => handleWriteTool(args, baseDir))
    this.server.registerTool('delete', deleteToolDefinition, (args) => handleDeleteTool(args, baseDir))
  }
}

export default FileSystemServer

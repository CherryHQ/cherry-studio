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

export function createFileSystemServer(baseDir?: string): McpServer {
  const root = resolveBaseDir(baseDir)
  void fs.mkdir(root, { recursive: true }).catch((error) => {
    logger.error('Failed to create filesystem MCP baseDir', { error, baseDir: root })
  })

  const server = new McpServer({ name: 'filesystem-server', version: '2.0.0' })
  server.registerTool('glob', globToolDefinition, (args) => handleGlobTool(args, root))
  server.registerTool('ls', lsToolDefinition, (args) => handleLsTool(args, root))
  server.registerTool('grep', grepToolDefinition, (args) => handleGrepTool(args, root))
  server.registerTool('read', readToolDefinition, (args) => handleReadTool(args, root))
  server.registerTool('edit', editToolDefinition, (args) => handleEditTool(args, root))
  server.registerTool('write', writeToolDefinition, (args) => handleWriteTool(args, root))
  server.registerTool('delete', deleteToolDefinition, (args) => handleDeleteTool(args, root))
  return server
}

function resolveBaseDir(baseDir?: string): string {
  const expandedBaseDir = baseDir ? expandHome(baseDir) : undefined
  if (expandedBaseDir && path.isAbsolute(expandedBaseDir)) {
    const resolved = normalizePath(path.resolve(expandedBaseDir))
    logger.info(`Using provided baseDir for filesystem MCP: ${resolved}`)
    return resolved
  }
  const workspace = application.getPath('feature.mcp.workspace')
  logger.info(`Using default workspace for filesystem MCP baseDir: ${workspace}`)
  return workspace
}

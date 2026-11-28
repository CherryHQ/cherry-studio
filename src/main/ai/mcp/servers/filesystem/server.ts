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

export function createFileSystemServer(baseDir?: string | string[]): McpServer {
  const roots = resolveBaseDirs(baseDir)
  void Promise.all(roots.map((root) => fs.mkdir(root, { recursive: true }))).catch((error) => {
    logger.error('Failed to create filesystem MCP baseDir', { error, baseDir: roots })
  })

  const server = new McpServer({ name: 'filesystem-server', version: '2.0.0' })
  server.registerTool('glob', globToolDefinition, (args) => handleGlobTool(args, roots))
  server.registerTool('ls', lsToolDefinition, (args) => handleLsTool(args, roots))
  server.registerTool('grep', grepToolDefinition, (args) => handleGrepTool(args, roots))
  server.registerTool('read', readToolDefinition, (args) => handleReadTool(args, roots))
  server.registerTool('edit', editToolDefinition, (args) => handleEditTool(args, roots))
  server.registerTool('write', writeToolDefinition, (args) => handleWriteTool(args, roots))
  server.registerTool('delete', deleteToolDefinition, (args) => handleDeleteTool(args, roots))
  return server
}

function resolveBaseDirs(baseDir?: string | string[]): string[] {
  const configuredRoots = (Array.isArray(baseDir) ? baseDir : baseDir ? [baseDir] : [])
    .map(expandHome)
    .filter((root) => path.isAbsolute(root))
  if (configuredRoots.length > 0) {
    const roots = configuredRoots.map((root) => normalizePath(path.resolve(root)))
    logger.info(`Using provided baseDirs for filesystem MCP: ${roots.join(', ')}`)
    return roots
  }
  const workspace = application.getPath('feature.mcp.workspace')
  logger.info(`Using default workspace for filesystem MCP baseDir: ${workspace}`)
  return [workspace]
}

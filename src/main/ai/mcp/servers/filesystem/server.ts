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

export function createFileSystemServer(baseDir?: string | readonly string[]): McpServer {
  const roots = resolveBaseDirs(baseDir)
  for (const root of roots) {
    void fs.mkdir(root, { recursive: true }).catch((error) => {
      logger.error('Failed to create filesystem MCP baseDir', { error, baseDir: root })
    })
  }

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

function resolveBaseDirs(baseDir?: string | readonly string[]): string[] {
  const configured = typeof baseDir === 'string' ? [baseDir] : (baseDir ?? [])
  const resolved: string[] = []
  for (const entry of configured) {
    const expanded = entry ? expandHome(entry) : ''
    if (!expanded || !path.isAbsolute(expanded)) continue
    const normalized = normalizePath(path.resolve(expanded))
    if (!resolved.includes(normalized)) resolved.push(normalized)
  }

  if (resolved.length > 0) {
    logger.info(`Using provided baseDirs for filesystem MCP: ${resolved.join(', ')}`)
    return resolved
  }

  const workspace = application.getPath('feature.mcp.workspace')
  logger.info(`Using default workspace for filesystem MCP baseDir: ${workspace}`)
  return [workspace]
}

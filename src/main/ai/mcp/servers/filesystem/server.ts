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

export function createFileSystemServer(baseDirs: readonly string[]): McpServer {
  const roots = resolveBaseDirs(baseDirs)
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

function resolveBaseDirs(baseDirs: readonly string[]): string[] {
  const roots = [
    ...new Set(
      baseDirs
        .map(expandHome)
        .filter(path.isAbsolute)
        .map((root) => normalizePath(path.resolve(root)))
    )
  ]
  return roots.length ? roots : [application.getPath('feature.mcp.workspace')]
}

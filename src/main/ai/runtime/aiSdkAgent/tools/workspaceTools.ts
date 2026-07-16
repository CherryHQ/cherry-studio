/**
 * Workspace file tools for the `ai-sdk` agent runtime (plan D6).
 *
 * Thin AI SDK adapters over the filesystem MCP server's handler cores
 * (`src/main/ai/mcp/servers/filesystem/tools`) with the session workspace as
 * the immutable base directory. All path validation — realpath/symlink
 * resolution, containment, per-result re-validation — lives in the shared
 * `validatePath`, so an escape (`../`, absolute outside, symlink out) throws
 * before any filesystem access. No tool accepts an alternate root.
 */

import {
  editToolDefinition,
  globToolDefinition,
  grepToolDefinition,
  handleEditTool,
  handleGlobTool,
  handleGrepTool,
  handleLsTool,
  handleReadTool,
  handleWriteTool,
  lsToolDefinition,
  readToolDefinition,
  writeToolDefinition
} from '@main/ai/mcp/servers/filesystem'
import { jsonSchema, type JSONSchema7, type Tool } from 'ai'

type FilesystemToolResult = { content: { type: string; text?: string }[] }
type FilesystemHandler = (args: unknown, baseDir: string) => Promise<FilesystemToolResult>
type FilesystemToolDefinition = { name: string; description: string; inputSchema: unknown }

/** The handlers return MCP-shaped content; the agent tool contract is plain text. */
function flattenText(result: FilesystemToolResult): string {
  return result.content
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

function adaptFilesystemTool(definition: FilesystemToolDefinition, handler: FilesystemHandler, baseDir: string): Tool {
  return {
    description: definition.description,
    inputSchema: jsonSchema(definition.inputSchema as JSONSchema7),
    execute: async (args: unknown) => flattenText(await handler(args, baseDir))
  }
}

export type WorkspaceFileToolName = 'read' | 'ls' | 'glob' | 'grep' | 'write' | 'edit'

/** Build the six workspace-rooted file tools, keyed by their runtime-native ids. */
export function buildWorkspaceFileTools(workspacePath: string): Record<WorkspaceFileToolName, Tool> {
  return {
    read: adaptFilesystemTool(readToolDefinition, handleReadTool, workspacePath),
    ls: adaptFilesystemTool(lsToolDefinition, handleLsTool, workspacePath),
    glob: adaptFilesystemTool(globToolDefinition, handleGlobTool, workspacePath),
    grep: adaptFilesystemTool(grepToolDefinition, handleGrepTool, workspacePath),
    write: adaptFilesystemTool(writeToolDefinition, handleWriteTool, workspacePath),
    edit: adaptFilesystemTool(editToolDefinition, handleEditTool, workspacePath)
  }
}

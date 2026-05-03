/**
 * `shell__exec` Layer 3 hook for the central permission pipeline.
 *
 * Reads `input.command`, parses it via the bash AST parser, then runs
 * the classifier. Returns a `PermissionDecision` the pipeline consumes.
 *
 * Async parse cost is amortized — first call pays the WASM init,
 * subsequent calls are sub-ms.
 */

import type { ToolCheckPermissions } from '@main/services/toolApproval/checkPermission'

import { classifyBash } from './classifier'
import { parseBashCommand } from './parser'

export const checkShellExecPermissions: ToolCheckPermissions = async (input) => {
  const command = readCommand(input)
  if (command === null) {
    return { behavior: 'deny', reason: 'shell__exec invoked without a string `command`.' }
  }
  const ast = await parseBashCommand(command)
  return classifyBash(ast)
}

function readCommand(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const c = (input as { command?: unknown }).command
  return typeof c === 'string' ? c : null
}

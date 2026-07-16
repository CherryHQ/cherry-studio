/**
 * Bounded workspace context for the AI SDK agent runtime's system prompt.
 *
 * Trust policy: the workspace is a directory the user explicitly selected for
 * this agent, so files at its root are trusted prompt input (the same stance
 * pi takes with `projectTrusted: true`). Only the two well-known context file
 * names at the workspace root are read — no recursive discovery, no
 * model-supplied paths — and each read is size-capped so a runaway file
 * cannot explode the prompt.
 */

import { open } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('aiSdkAgentWorkspaceContext')

/** Well-known context files read from the workspace root, in inclusion order. */
export const WORKSPACE_CONTEXT_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const

/** Per-file byte cap; content beyond it is dropped with a visible truncation marker. */
export const MAX_WORKSPACE_CONTEXT_FILE_BYTES = 16 * 1024

export interface WorkspaceContextFile {
  fileName: string
  content: string
  truncated: boolean
}

/** Read the existing workspace context files, bounded. Missing files are skipped silently. */
export async function readWorkspaceContextFiles(workspacePath: string): Promise<WorkspaceContextFile[]> {
  const files: WorkspaceContextFile[] = []
  for (const fileName of WORKSPACE_CONTEXT_FILE_NAMES) {
    const filePath = path.join(workspacePath, fileName)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(filePath, 'r')
      const stat = await handle.stat()
      if (!stat.isFile()) continue
      const buffer = Buffer.alloc(MAX_WORKSPACE_CONTEXT_FILE_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const truncated = bytesRead > MAX_WORKSPACE_CONTEXT_FILE_BYTES
      const content = buffer.subarray(0, Math.min(bytesRead, MAX_WORKSPACE_CONTEXT_FILE_BYTES)).toString('utf8')
      if (content.trim().length > 0) files.push({ fileName, content, truncated })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Context files are best-effort prompt input; an unreadable file must not fail the turn.
        logger.warn('Failed to read workspace context file', { filePath, error })
      }
    } finally {
      await handle?.close()
    }
  }
  return files
}

/** Render the workspace section of the agent system prompt. */
export function buildWorkspaceContextSection(workspacePath: string, files: readonly WorkspaceContextFile[]): string {
  const sections = [`# Workspace\n\nYour working directory is: ${workspacePath}`]
  for (const file of files) {
    const marker = file.truncated
      ? `\n\n[Truncated: only the first ${MAX_WORKSPACE_CONTEXT_FILE_BYTES} bytes are shown]`
      : ''
    sections.push(`## ${file.fileName}\n\n${file.content}${marker}`)
  }
  return sections.join('\n\n')
}

import { constants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

import { loggerService } from '@logger'

const logger = loggerService.withContext('AgentsMdLoader')
const AGENTS_FILE_NAME = 'AGENTS.md'
const AGENTS_MD_SCOPE_GUIDANCE = `## Workspace Instructions (AGENTS.md)

AGENTS.md files contain repository instructions scoped by directory. Instructions apply to the directory containing the file and all descendants; the closest AGENTS.md to a target path takes precedence. Explicit user instructions take precedence over AGENTS.md.

Structured file tools load applicable AGENTS.md files automatically before they run. Before using Bash or another unstructured tool to inspect or change files, first locate and read every applicable AGENTS.md from the workspace root through the target directory.`
const CLAUDE_FILE_PATHS = ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')] as const
const TOOL_PATH_FIELDS = {
  Edit: { field: 'file_path', kind: 'file' },
  Glob: { field: 'path', kind: 'directory' },
  Grep: { field: 'path', kind: 'directory' },
  NotebookEdit: { field: 'notebook_path', kind: 'file' },
  Read: { field: 'file_path', kind: 'file' },
  Write: { field: 'file_path', kind: 'file' }
} as const

type TargetKind = 'file' | 'directory'

export class AgentsMdLoader {
  private readonly loadedCandidates = new Set<string>()

  private constructor(
    private readonly workspacePath: string,
    private readonly resolvedWorkspacePath: string
  ) {}

  static async create(workspacePath: string): Promise<AgentsMdLoader> {
    return new AgentsMdLoader(path.resolve(workspacePath), await realpath(workspacePath))
  }

  async loadInitialContext(): Promise<string> {
    return (await this.loadForTarget(this.workspacePath, 'directory')) ?? AGENTS_MD_SCOPE_GUIDANCE
  }

  async loadForTool(toolName: string, toolInput: unknown): Promise<string | undefined> {
    const pathConfig = TOOL_PATH_FIELDS[toolName as keyof typeof TOOL_PATH_FIELDS]
    if (!pathConfig || !toolInput || typeof toolInput !== 'object') return undefined

    const requestedPath = (toolInput as Record<string, unknown>)[pathConfig.field]
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) return undefined

    const targetPath = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(this.workspacePath, requestedPath)
    return this.loadForTarget(targetPath, pathConfig.kind)
  }

  createPreToolUseHook(): HookCallback {
    return async (input): Promise<HookJSONOutput> => {
      if (!input || input.hook_event_name !== 'PreToolUse') return {}

      try {
        const context = await this.loadForTool(input.tool_name, input.tool_input)
        if (!context) return {}
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: context
          }
        }
      } catch (error) {
        logger.error('Failed to load applicable AGENTS.md instructions', error as Error)
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'The applicable AGENTS.md instructions could not be loaded safely. Resolve the file access error before retrying this operation.'
          }
        }
      }
    }
  }

  private async loadForTarget(targetPath: string, targetKind: TargetKind): Promise<string | undefined> {
    if (!this.isInsideWorkspace(targetPath)) return undefined

    const targetDirectory = targetKind === 'directory' ? targetPath : path.dirname(targetPath)
    const directories = this.getDirectoryChain(targetDirectory)
    const nativeInstructionFiles = await this.resolveNativeInstructionFiles(directories)
    const sections: string[] = []

    for (const directory of directories) {
      const candidatePath = path.join(directory, AGENTS_FILE_NAME)
      const resolvedPath = await this.resolveInstructionFile(candidatePath)
      if (!resolvedPath || nativeInstructionFiles.has(resolvedPath) || this.loadedCandidates.has(candidatePath))
        continue

      const content = await this.readInstructionFile(resolvedPath)
      this.loadedCandidates.add(candidatePath)
      if (!content) continue

      const scopePath = path.relative(this.workspacePath, directory) || '.'
      sections.push(
        `### ${candidatePath}\n\nScope: this file applies to ${scopePath === '.' ? 'the entire workspace' : `\`${scopePath}/\` and its descendants`}. When AGENTS.md instructions conflict, the file closest to the target path takes precedence.\n\n${content}`
      )
    }

    if (sections.length === 0) return undefined
    return `${AGENTS_MD_SCOPE_GUIDANCE}\n\n${sections.join('\n\n')}`
  }

  private getDirectoryChain(targetDirectory: string): string[] {
    const relative = path.relative(this.workspacePath, targetDirectory)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return []

    const directories = [this.workspacePath]
    if (!relative) return directories

    let current = this.workspacePath
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment)
      directories.push(current)
    }
    return directories
  }

  private async resolveNativeInstructionFiles(directories: readonly string[]): Promise<Set<string>> {
    const resolvedFiles = new Set<string>()
    for (const directory of directories) {
      for (const relativePath of CLAUDE_FILE_PATHS) {
        const resolvedPath = await this.resolveInstructionFile(path.join(directory, relativePath))
        if (resolvedPath) resolvedFiles.add(resolvedPath)
      }
    }
    return resolvedFiles
  }

  private async resolveInstructionFile(filePath: string): Promise<string | undefined> {
    try {
      const fileStat = await lstat(filePath)
      if (!fileStat.isFile() && !fileStat.isSymbolicLink()) return undefined

      const resolvedPath = await realpath(filePath)
      if (!this.isInsideResolvedWorkspace(resolvedPath)) {
        logger.warn('Ignoring instruction file that resolves outside the workspace', { path: filePath })
        return undefined
      }
      if (!(await stat(resolvedPath)).isFile()) return undefined
      return resolvedPath
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
      throw error
    }
  }

  private async readInstructionFile(resolvedPath: string): Promise<string> {
    let handle
    try {
      const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW
      handle = await open(resolvedPath, flags)
      const fileStat = await handle.stat()
      if (!fileStat.isFile()) throw new Error(`AGENTS.md is not a regular file: ${resolvedPath}`)
      return (await handle.readFile('utf8')).trim()
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  private isInsideWorkspace(targetPath: string): boolean {
    const relative = path.relative(this.workspacePath, path.resolve(targetPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private isInsideResolvedWorkspace(targetPath: string): boolean {
    const relative = path.relative(this.resolvedWorkspacePath, targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
}

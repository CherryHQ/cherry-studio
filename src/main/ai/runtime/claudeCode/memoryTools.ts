import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  CanUseTool,
  SyncHookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput
} from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { loggerService } from '@logger'
import { agentMemoryAuthority } from '@main/ai/memory/memoryAuthority'
import { MEMORY_MAX_BYTES } from '@main/ai/memory/memoryFiles'
import type { MemorySession } from '@main/ai/memory/MemoryService'
import { memoryTarget, type MemoryTarget } from '@main/ai/memory/memoryTarget'
import type { Disposable } from '@main/core/lifecycle'

const logger = loggerService.withContext('ClaudeMemoryTools')
const fileTools = new Set(['Read', 'Write', 'Edit'])
export const CLAUDE_MEMORY_UNCONFIRMED =
  'Managed memory was not confirmed saved. Only a temporary working copy may have changed. Read the original memory file before retrying.'

/** Successful native results are rewritten to their logical path; a scratch path is never a save receipt. */
export function isClaudeMemoryWorkingCopy(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parts = value.replaceAll('\\', '/').split('/')
  return /^cherry-memory-native-[a-z\d]+$/i.test(parts.at(-2) ?? '')
}

type FileState = {
  target: MemoryTarget
  session: MemorySession
  stage: string
  hash: string | null
  receipt: string
  fullRead: boolean
}
type Call = {
  input: PreToolUseHookInput
  file: FileState
  assertActive(): undefined
  result?: Promise<SyncHookJSONOutput>
  finished?: boolean
}

/** Per-session adapter; native tools edit scratch files and MemoryService owns the final write. */
export class ClaudeMemoryTools {
  private readonly files = new Map<string, FileState>()
  private readonly calls = new Map<string, Call>()
  private readonly busy = new Map<string, string>()
  private readonly scratch = new Set<string>()
  private directory?: Promise<string>
  private turnId?: string
  private epoch = 0
  private disposed = false
  private terminal?: Disposable

  constructor(
    private readonly sessionId: string,
    private readonly cwd: string,
    private readonly authorize: CanUseTool
  ) {}

  async prepare(input: PreToolUseHookInput, signal: AbortSignal): Promise<Record<string, unknown> | undefined> {
    if (!fileTools.has(input.tool_name)) return undefined
    const args = input.tool_input as Record<string, unknown>
    if (typeof args.file_path !== 'string') return undefined
    let requested = args.file_path
    if (requested.startsWith('file://')) requested = fileURLToPath(requested)
    else if (requested === '~' || requested.startsWith('~/') || requested.startsWith('~\\'))
      requested = path.join(application.getPath('sys.home'), requested.slice(2))
    const absolutePath = path.resolve(this.cwd, requested)
    if (isClaudeMemoryWorkingCopy(absolutePath)) throw new Error('Use the original memory path, not its working copy')
    const target = await memoryTarget(absolutePath)
    if (!target) return undefined
    if (input.agent_id) throw new Error('Memory file access requires the owning desktop Agent turn')
    const runtime = application.get('AgentSessionRuntimeService')
    const turnId = runtime.getLiveAssistantMessageId(this.sessionId)
    if (!turnId) throw new Error('Memory turn has ended')
    if (turnId !== this.turnId) {
      await this.reset()
      this.turnId = turnId
    }
    this.terminal ??= runtime.onTurnTerminal((event) => {
      if (event.sessionId === this.sessionId && event.assistantMessageId === this.turnId)
        void this.reset().catch((error) => logger.warn('Memory working-copy cleanup failed', { error }))
    })
    const epoch = this.epoch
    const assertActive = (): undefined => {
      signal.throwIfAborted()
      const policy = application.get('ClaudeCodeSessionStateService').getToolPolicySnapshot(this.sessionId)
      if (
        this.disposed ||
        epoch !== this.epoch ||
        runtime.getLiveAssistantMessageId(this.sessionId) !== turnId ||
        runtime.getInteractionState(this.sessionId).currentTurn !== 'interactive'
      )
        throw new Error('Memory turn has ended')
      if (!policy || policy.isDisabled(input.tool_name)) throw new Error('This memory file tool is disabled')
      if (input.tool_name !== 'Read' && policy.getPermissionMode() === 'plan') throw new Error('Plan mode is read-only')
      return undefined
    }
    assertActive()
    if (this.busy.has(target.absolutePath))
      throw new Error('Another operation is using this memory file; retry after it finishes')
    this.busy.set(target.absolutePath, input.tool_use_id)
    let file = this.files.get(target.absolutePath)
    let allocatedStage: string | undefined
    try {
      if (input.tool_name === 'Read' || !file) {
        file?.session.dispose()
        if (file) await this.removeScratch(file.stage)
        if (this.files.get(target.absolutePath) === file) this.files.delete(target.absolutePath)
        const authority = agentMemoryAuthority(this.sessionId, target.scope.kind, {
          assertActive,
          isHeadless: () => false
        })
        if (
          target.scope.kind === 'private' &&
          (authority.scope.kind !== 'private' || authority.scope.agentId !== target.scope.agentId)
        )
          throw new Error('Another Agent’s private memory is not available')
        const session = application.get('MemoryService').open(authority)
        try {
          const read = await session.read(target.path)
          assertActive()
          if (input.tool_name !== 'Read' && read.content !== null)
            throw new Error('Read this memory file completely before editing it')
          if (read.content !== null && Buffer.byteLength(read.content) > MEMORY_MAX_BYTES)
            throw new Error('Memory file exceeds the complete-read budget')
          if (input.tool_name === 'Read') await this.approve(input, args, signal, assertActive)
          const directory = await (this.directory ??= this.createDirectory())
          assertActive()
          const stage = path.join(directory, `${randomUUID()}.md`)
          allocatedStage = stage
          this.scratch.add(stage)
          if (read.content !== null) await writeFile(stage, read.content, { flag: 'wx', mode: 0o600 })
          assertActive()
          file = { target, session, stage, hash: read.hash, receipt: read.receipt, fullRead: read.content === null }
          this.files.set(target.absolutePath, file)
          assertActive()
        } catch (error) {
          session.dispose()
          throw error
        }
      }
      if (input.tool_name !== 'Read' && (!file.fullRead || !file.receipt))
        throw new Error('A complete, writable memory read in this turn is required')
      if (input.tool_name !== 'Read' && file.hash !== null) {
        const current = await file.session.read(target.path)
        if (current.hash !== file.hash) throw new Error('Memory changed; read it again before editing')
      }
      assertActive()
      this.calls.set(input.tool_use_id, { input, file, assertActive })
      return { ...args, file_path: file.stage }
    } catch (error) {
      if (this.busy.get(target.absolutePath) === input.tool_use_id) this.busy.delete(target.absolutePath)
      if (file) {
        file.fullRead = false
        file.session.dispose()
        if (this.files.get(target.absolutePath) === file) this.files.delete(target.absolutePath)
        await this.removeScratch(file.stage)
      }
      if (allocatedStage && allocatedStage !== file?.stage) await this.removeScratch(allocatedStage)
      throw error
    }
  }

  complete(input: PostToolUseHookInput, signal: AbortSignal): Promise<SyncHookJSONOutput> {
    const call = this.calls.get(input.tool_use_id)
    if (!call) return Promise.resolve({})
    return (call.result ??= this.finish(call, input, signal))
  }

  private async finish(call: Call, input: PostToolUseHookInput, signal: AbortSignal): Promise<SyncHookJSONOutput> {
    const { file } = call
    const response = input.tool_response as Record<string, unknown>
    try {
      call.assertActive()
      if ((input.tool_input as Record<string, unknown>).file_path !== file.stage)
        throw new Error('The native memory execution path changed')
      if (input.tool_name === 'Read') {
        await file.session.validateModelReads()
        call.assertActive()
        const read = response.file as {
          startLine?: number
          numLines?: number
          totalLines?: number
          truncatedByTokenCap?: boolean
        }
        const args = call.input.tool_input as Record<string, unknown>
        file.fullRead =
          !!file.receipt &&
          args.offset === undefined &&
          args.limit === undefined &&
          read?.startLine === 1 &&
          read.numLines === read.totalLines &&
          !read.truncatedByTokenCap
        return {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedToolOutput: {
              ...response,
              file: { ...read, filePath: file.target.absolutePath }
            }
          }
        }
      }
      const stat = await lstat(file.stage)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MEMORY_MAX_BYTES)
        throw new Error('Invalid memory working copy')
      const bytes = await readFile(file.stage)
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const result = await file.session.commit([{ kind: 'write', receipt: file.receipt, content }], async (changes) => {
        const policy = application.get('ClaudeCodeSessionStateService').getToolPolicySnapshot(this.sessionId)
        const mode = policy?.getPermissionMode()
        await this.approve(
          call.input,
          {
            ...(call.input.tool_input as Record<string, unknown>),
            path: file.target.absolutePath,
            memoryPreview: changes
          },
          signal,
          call.assertActive
        )
        return () => {
          call.assertActive()
          if (policy?.getPermissionMode() !== mode) throw new Error('Memory approval is no longer active')
          return undefined
        }
      })
      if (
        result.error ||
        !result.files.length ||
        result.files.some((item) => item.outcome !== 'applied' && item.outcome !== 'unchanged')
      )
        throw new Error(CLAUDE_MEMORY_UNCONFIRMED)
      file.fullRead = false
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: {
            ...response,
            filePath: file.target.absolutePath
          }
        }
      }
    } catch (error) {
      file.fullRead = false
      logger.warn('Native memory operation was not confirmed', { toolName: input.tool_name, error })
      // Keep writes attributed to the scratch file. The SDK cannot replace native success with an error result.
      const readFailure =
        input.tool_name === 'Read'
          ? {
              updatedToolOutput: {
                type: 'text',
                file: {
                  filePath: file.stage,
                  content: CLAUDE_MEMORY_UNCONFIRMED,
                  startLine: 1,
                  numLines: 1,
                  totalLines: 1
                }
              }
            }
          : {}
      return {
        continue: false,
        stopReason: CLAUDE_MEMORY_UNCONFIRMED,
        decision: 'block',
        reason: CLAUDE_MEMORY_UNCONFIRMED,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: CLAUDE_MEMORY_UNCONFIRMED,
          ...readFailure
        }
      }
    } finally {
      call.finished = true
      if (this.busy.get(file.target.absolutePath) === input.tool_use_id) this.busy.delete(file.target.absolutePath)
    }
  }

  private async approve(
    input: PreToolUseHookInput,
    args: Record<string, unknown>,
    signal: AbortSignal,
    assertActive: () => undefined
  ) {
    assertActive()
    const original = JSON.stringify(args)
    const result = await this.authorize(input.tool_name, args, {
      signal,
      toolUseID: input.tool_use_id,
      requestId: randomUUID()
    })
    if (!result || result.behavior !== 'allow') throw new Error(result?.message ?? 'Memory approval was not granted')
    if (JSON.stringify(result.updatedInput ?? args) !== original)
      throw new Error('Approved memory input changed; submit the revised operation again')
    assertActive()
  }

  release(toolCallId: string): void {
    const call = this.calls.get(toolCallId)
    if (!call) return
    if (!call.result) call.file.fullRead = false
    if (this.busy.get(call.file.target.absolutePath) === toolCallId) this.busy.delete(call.file.target.absolutePath)
    this.calls.delete(toolCallId)
  }

  private async createDirectory() {
    await mkdir(application.getPath('app.temp'), { recursive: true })
    return mkdtemp(application.getPath('app.temp', 'cherry-memory-native-'))
  }

  private async removeScratch(file: string) {
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    this.scratch.delete(file)
  }

  private async reset() {
    this.epoch++
    this.turnId = undefined
    for (const file of this.files.values()) file.session.dispose()
    this.files.clear()
    this.busy.clear()
    for (const [id, call] of this.calls) if (call.finished) this.calls.delete(id)
    for (const file of [...this.scratch]) await this.removeScratch(file)
  }

  async dispose() {
    this.disposed = true
    this.terminal?.dispose()
    await this.reset()
    this.calls.clear()
    if (this.directory)
      await rmdir(await this.directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
  }
}

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ExtensionFactory, ToolDefinition } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { agentMemoryAuthority } from '@main/ai/memory/memoryAuthority'
import { MEMORY_MAX_BYTES } from '@main/ai/memory/memoryFiles'
import type { MemorySession } from '@main/ai/memory/MemoryService'
import type { MemoryApproval, MemoryCommitResult } from '@main/ai/memory/MemoryStore'
import { memoryTarget, type MemoryTarget } from '@main/ai/memory/memoryTarget'
import { normalizePiNativePathInput } from '@main/ai/toolApproval/userDataSqliteGuard'

import { createPiToolAuthorizer, type PiApprovalContext } from './approvalExtension'
import type { loadPiSdk } from './piSdk'

export const PI_MEMORY_FILE_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit'])

export function createPiMemoryTools(pi: Awaited<ReturnType<typeof loadPiSdk>>, context: PiApprovalContext) {
  const authorize = createPiToolAuthorizer(context)
  const sessions = new Map<string, MemorySession>()
  const reads = new Map<string, { path: string; scope: string; hash: string | null }>()
  let epoch = 0
  let active = false
  const dispose = () => {
    active = false
    epoch++
    for (const session of sessions.values()) session.dispose()
    sessions.clear()
    reads.clear()
  }
  const extension: ExtensionFactory = (api) => {
    api.on('before_agent_start', async () => {
      dispose()
      active = true
    })
    api.on('session_shutdown', async () => dispose())
  }
  const scopeKey = (target: MemoryTarget) =>
    target.scope.kind === 'shared' ? 'shared' : `private/${target.scope.agentId}`
  function sessionFor(target: MemoryTarget, signal: AbortSignal | undefined) {
    signal?.throwIfAborted()
    const started = epoch
    const interaction = context.getInteractionState().currentTurn
    const authority = agentMemoryAuthority(context.sessionId, target.scope.kind, {
      assertActive: () => {
        if (
          !active ||
          started !== epoch ||
          interaction === 'none' ||
          context.getInteractionState().currentTurn !== interaction
        )
          throw new Error('Memory turn has ended')
        return undefined
      },
      isHeadless: () => interaction !== 'interactive'
    })
    if (
      target.scope.kind === 'private' &&
      (authority.scope.kind !== 'private' || authority.scope.agentId !== target.scope.agentId)
    )
      throw new Error('Another Agent’s private memory is not available')
    const key = scopeKey(target)
    let session = sessions.get(key)
    if (!session) {
      session = application.get('MemoryService').open(authority)
      sessions.set(key, session)
    }
    return session
  }
  function resolve(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('A file path is required')
    let target = normalizePiNativePathInput(raw)
    if (target.startsWith('file://')) return fileURLToPath(target)
    if (target === '~') target = application.getPath('sys.home')
    else if (target.startsWith('~/') || (process.platform === 'win32' && target.startsWith('~\\')))
      target = path.join(application.getPath('sys.home'), target.slice(2))
    return path.resolve(context.workspacePath, target)
  }
  const originals: ToolDefinition[] = [
    pi.createReadToolDefinition(context.workspacePath) as ToolDefinition,
    pi.createWriteToolDefinition(context.workspacePath) as ToolDefinition,
    pi.createEditToolDefinition(context.workspacePath) as ToolDefinition
  ]
  const tools = originals.map(
    (original): ToolDefinition => ({
      ...original,
      description: `${original.description}\nFor managed memory files, read the complete file first (omit offset/limit), then pass its memoryReceipt to write or edit. Reading an absent file supplies the baseline for creation. Entry injection is not a full read. Only these controlled operations provide memory backups and conflict checks.`,
      parameters:
        original.name === 'read'
          ? original.parameters
          : {
              ...original.parameters,
              properties: {
                ...('properties' in original.parameters
                  ? (original.parameters.properties as Record<string, unknown>)
                  : {}),
                memoryReceipt: {
                  type: 'string',
                  description: 'Receipt returned by a complete memory read in this turn.'
                }
              }
            },
      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        const args = params as Record<string, unknown>
        signal?.throwIfAborted()
        if (context.isDisabled(original.name)) throw new Error(`Tool "${original.name}" is disabled for this Agent`)
        const target = await memoryTarget(resolve(args.path))
        if (target && original.name === 'read') sessionFor(target, signal)
        if (!target || original.name === 'read') {
          const decision = await authorize({ toolName: original.name, toolCallId, input: args, signal })
          if (decision?.block) throw new Error(decision.reason)
          const approvedTarget = await memoryTarget(resolve(args.path))
          if (!approvedTarget) return original.execute(toolCallId, params, signal, onUpdate, ctx)
          if (original.name !== 'read')
            throw new Error('Read this memory file completely before requesting a controlled edit')
          if (args.offset !== undefined || args.limit !== undefined)
            throw new Error('Memory reads must be complete; omit offset and limit')
          const session = sessionFor(approvedTarget, signal)
          const file = await session.read(approvedTarget.path)
          signal?.throwIfAborted()
          if (file.content !== null && Buffer.byteLength(file.content, 'utf8') > MEMORY_MAX_BYTES)
            throw new Error(
              'This memory file exceeds the model read budget. Review the full file in Settings before editing it.'
            )
          reads.set(file.receipt, { path: approvedTarget.path, scope: scopeKey(approvedTarget), hash: file.hash })
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  path: approvedTarget.absolutePath,
                  content: file.content,
                  hash: file.hash,
                  memoryReceipt: file.receipt
                })
              }
            ],
            details: undefined
          }
        }
        const session = sessionFor(target, signal)
        const receipt = typeof args.memoryReceipt === 'string' ? args.memoryReceipt : ''
        const baseline = reads.get(receipt)
        if (!baseline || baseline.path !== target.path || baseline.scope !== scopeKey(target))
          throw new Error('A complete read of this memory file in the current turn is required')
        const started = epoch
        const approve: MemoryApproval = async (changes) => {
          const input = { ...args, memoryPreview: changes }
          const before = JSON.stringify(input)
          const mode = context.getPermissionMode()
          const decision = await authorize({ toolName: original.name, toolCallId, input, signal })
          if (decision?.block) throw new Error(decision.reason)
          if (JSON.stringify(input) !== before)
            throw new Error('The approved input changed. Read again and submit the revised memory edit.')
          return () => {
            signal?.throwIfAborted()
            if (
              !active ||
              epoch !== started ||
              context.isDisabled(original.name) ||
              context.getPermissionMode() !== mode
            )
              throw new Error('Memory edit approval is no longer active')
            return undefined
          }
        }
        let committed: MemoryCommitResult | undefined
        const save = async (content: string) => {
          committed = await session.commit([{ kind: 'write', receipt, content }], approve)
          if (
            committed.error ||
            committed.files.some((file) => file.outcome !== 'applied' && file.outcome !== 'unchanged')
          )
            throw new Error(`Memory edit did not fully complete: ${JSON.stringify(committed)}`)
        }
        if (original.name === 'write') {
          if (typeof args.content !== 'string') throw new Error('Memory content must be text')
          await save(args.content)
          return { content: [{ type: 'text', text: JSON.stringify(committed) }], details: undefined }
        }
        const current = await session.read(target.path)
        if (current.hash !== baseline.hash || current.content === null)
          throw new Error('Memory changed since the bound read')
        const edit = pi.createEditToolDefinition(context.workspacePath, {
          operations: {
            access: async () => signal?.throwIfAborted(),
            readFile: async () => Buffer.from(current.content!),
            writeFile: async (_path, content) => save(content)
          }
        }) as ToolDefinition
        const result = await edit.execute(toolCallId, { ...args, path: target.absolutePath }, signal, onUpdate, ctx)
        if (!committed) throw new Error('The memory edit did not produce a controlled commit result')
        return {
          ...result,
          content: [...result.content, { type: 'text', text: JSON.stringify(committed) }]
        }
      }
    })
  )
  return { tools, extension, dispose }
}

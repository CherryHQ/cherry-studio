import path from 'node:path'

import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'

import type { AgentFileWriteService } from '../AgentFileWriteService'

const FILE_WRITE_FIELDS: Readonly<Record<string, string>> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path'
}

/** One owner per SDK process, including parked queries; never look up a replacement owner by session id. */
export function withClaudeFileWriteProtection(options: Options): Options {
  const spawn = options.spawnClaudeCodeProcess
  if (!spawn) throw new Error('Claude file protection requires the managed process spawner.')
  const owner = {}
  let alive = false
  let spawned = false
  let locks: AgentFileWriteService | undefined
  const calls = new Set<string>()
  const key = (agentId: string | undefined, callId: string) => JSON.stringify([agentId ?? '', callId])
  const release = (agentId: string | undefined, callId: string) => {
    const id = key(agentId, callId)
    if (!calls.delete(id)) return
    locks?.release(owner, id)
  }
  const before: HookCallback = async (input, _id, context) => {
    if (input.hook_event_name !== 'PreToolUse') return {}
    const field = FILE_WRITE_FIELDS[input.tool_name]
    if (!field) return {}
    const id = key(input.agent_id, input.tool_use_id)
    try {
      if (!alive || options.abortController?.signal.aborted)
        throw new Error('FILE_WRITE_OWNER_STOPPED: the runtime process is unavailable.')
      const args = input.tool_input as Record<string, unknown> | null
      const target = args?.[field]
      if (
        typeof target !== 'string' ||
        !target.trim() ||
        target.startsWith('~') ||
        (!path.isAbsolute(target) && !options.cwd)
      )
        throw new Error('FILE_TARGET_UNVERIFIABLE: use an absolute file target.')
      context.signal.throwIfAborted()
      calls.add(id)
      locks ??= application.get('AgentFileWriteService')
      await locks.acquire(owner, id, path.resolve(options.cwd ?? '', target))
      context.signal.throwIfAborted()
      return {}
    } catch (error) {
      release(input.agent_id, input.tool_use_id)
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: error instanceof Error ? error.message : 'FILE_TARGET_UNVERIFIABLE'
        }
      }
    }
  }
  const after: HookCallback = async (input) => {
    if (input.hook_event_name === 'PostToolUse' || input.hook_event_name === 'PostToolUseFailure')
      release(input.agent_id, input.tool_use_id)
    if (input.hook_event_name === 'PostToolBatch')
      for (const call of input.tool_calls) release(input.agent_id, call.tool_use_id)
    return {}
  }
  return {
    ...options,
    hooks: {
      ...options.hooks,
      PreToolUse: [...(options.hooks?.PreToolUse ?? []), { hooks: [before] }],
      PostToolUse: [...(options.hooks?.PostToolUse ?? []), { hooks: [after] }],
      PostToolUseFailure: [...(options.hooks?.PostToolUseFailure ?? []), { hooks: [after] }],
      PostToolBatch: [...(options.hooks?.PostToolBatch ?? []), { hooks: [after] }]
    },
    spawnClaudeCodeProcess: (input) => {
      if (spawned) throw new Error('A file-write owner cannot be reused for another process.')
      spawned = true
      const child = spawn(input)
      alive = true
      child.once('exit', () => {
        alive = false
        calls.clear()
        locks?.runtimeExited(owner)
      })
      return child
    }
  }
}

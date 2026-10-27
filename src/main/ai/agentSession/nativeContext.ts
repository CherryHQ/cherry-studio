import { lstatSync, readdirSync } from 'node:fs'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { v4 as uuid } from 'uuid'

import { application } from '@application'
import { runtimeId, type OperationResult, type Thread, type ThreadHandle } from '@cherrystudio/agent-runtime'
import { createPiRuntime, type AgentRuntimeSessionOptions, type PiRuntime } from '@cherrystudio/agent-runtime-pi'
import type { PiDurableRuntime } from '@cherrystudio/agent-runtime-pi-durable'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

export function loadPiSession(backendId: string, nativeId: string, cwd?: string): SessionManager {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nativeId)) throw new Error('Invalid Pi session identity')
  const directory = application.getPath('feature.agents.pi.sessions')
  const files = readdirSync(directory).filter((file) => file.endsWith(`_${nativeId}.jsonl`))
  if (files.length !== 1) throw new Error('Pi session is missing or ambiguous')
  const file = application.getPath('feature.agents.pi.sessions', files[0])
  if (!lstatSync(file).isFile()) throw new Error('Pi session must be a regular file')
  return SessionManager.openExisting(file, nativeId, cwd)
}

export function openPiBackend(backendId: string, loadOptions: (thread: Thread) => Promise<AgentRuntimeSessionOptions>) {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  return createPiRuntime({
    backendId: runtimeId(backendId),
    load: async (thread) => {
      const sessionManager = loadPiSession(backendId, thread.id)
      return { ...(await loadOptions(thread)), sessionManager }
    }
  })
}

export async function createPiContext(
  sessionId: string,
  backendId: string,
  runtime: PiRuntime,
  options: AgentRuntimeSessionOptions
) {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  const intent = contexts.allocateContext(sessionId, backendId, uuid())
  const sessionManager = SessionManager.create(options.cwd, application.getPath('feature.agents.pi.sessions'), {
    id: intent.intendedThreadId!
  })
  const result = await runtime.create({ ...options, sessionManager })
  if (
    result.status === 'confirmed' &&
    (result.value.thread.backendId !== backendId || result.value.thread.id !== intent.intendedThreadId)
  )
    throw new Error('Created Pi identity does not match the intent')
  return { context: intent, result }
}

export function confirmPiContext(contextId: string) {
  const context = contexts.context(contextId)
  if (!context.intendedThreadId) throw new Error('Pi context has no native identity')
  loadPiSession(context.backendId, context.intendedThreadId)
  return contexts.bindContext(context.id, context.intendedThreadId)
}

export async function openNativeContext(
  contextId: string,
  runtime: PiRuntime | PiDurableRuntime
): Promise<OperationResult<ThreadHandle>> {
  const context = contexts.context(contextId)
  if (!context.nativeThreadId) throw new Error('Native context is unbound')
  return runtime.open({ backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) })
}

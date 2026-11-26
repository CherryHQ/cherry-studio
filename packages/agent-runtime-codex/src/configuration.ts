import type * as z from 'zod'

import { CodexRequestError, type CodexAppServerClient, type CodexRequestParams } from './appServerClient'
import {
  CODEX_LOCAL_MODE_ID,
  CODEX_LOCAL_MODE_OPTIONS,
  CODEX_LOCAL_THOUGHT_LEVEL_ID,
  CODEX_LOCAL_THOUGHT_LEVEL_OPTIONS
} from './cli'
import type { responses } from './responses'

export type CodexThreadRestore = { threadId: string; kind: 'required' | 'empty-prewarm' }

export interface SessionOptions {
  cwd: string
  restore?: CodexThreadRestore
  model?: string
  headless: boolean
  signal: AbortSignal
  mcp?: { name: string; url: string; tokenEnv: string; approvedTools: readonly string[] }
}
export type CodexMode = (typeof CODEX_LOCAL_MODE_OPTIONS)[number]['value']

export const CODEX_TURN_MODE_PARAMS = {
  readOnly: {
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'readOnly', networkAccess: false }
  },
  workspace: {
    approvalPolicy: 'on-request',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    }
  },
  fullAccess: {
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' }
  }
} satisfies Record<CodexMode, Pick<CodexRequestParams['turn/start'], 'approvalPolicy' | 'sandboxPolicy'>>

export const UNATTENDED_TURN_MODE = {
  approvalPolicy: 'never' as const,
  sandboxPolicy: CODEX_TURN_MODE_PARAMS.readOnly.sandboxPolicy
}
const CODEX_EFFORT_LABELS: Record<string, string> = {
  default: 'Default',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max'
}

function buildCodexThoughtLevelOptions(
  efforts?: Array<{ reasoningEffort: string; description?: string }>
): Array<{ value: string; name: string; description?: string }> {
  if (!efforts?.length) return CODEX_LOCAL_THOUGHT_LEVEL_OPTIONS.map((option) => ({ ...option }))
  const seen = new Set<string>(['default'])
  const options: Array<{ value: string; name: string; description?: string }> = [{ value: 'default', name: 'Default' }]
  for (const entry of efforts) {
    if (!entry.reasoningEffort || seen.has(entry.reasoningEffort)) continue
    seen.add(entry.reasoningEffort)
    options.push({
      value: entry.reasoningEffort,
      name: CODEX_EFFORT_LABELS[entry.reasoningEffort] ?? entry.reasoningEffort,
      ...(entry.description ? { description: entry.description } : {})
    })
  }
  return options
}

export function chatArgs({ headless, mcp }: SessionOptions): string[] {
  if (headless)
    return ['-c', 'web_search="disabled"', '--disable', 'plugins', '--disable', 'apps', '--disable', 'hooks']
  if (!mcp) return []
  const prefix = `mcp_servers.${mcp.name}`
  return [
    '-c',
    `${prefix}.url=${JSON.stringify(mcp.url)}`,
    '-c',
    `${prefix}.bearer_token_env_var=${JSON.stringify(mcp.tokenEnv)}`,
    '-c',
    `${prefix}.enabled=true`,
    ...mcp.approvedTools.flatMap((name) => ['-c', `${prefix}.tools.${name}.approval_mode="approve"`])
  ]
}

export async function openThread(
  server: CodexAppServerClient,
  options: SessionOptions,
  bind: (thread: OpenThread) => void
) {
  const { cwd, model, restore, headless, mcp } = options
  const models = await server.listModels()
  const params: CodexRequestParams['thread/start'] = { cwd, ...(model && { model }) }
  if (headless) {
    options.signal.throwIfAborted()
    const { config } = await server.request('config/read', { cwd })
    params.approvalPolicy = 'never'
    params.sandbox = 'read-only'
    params.config = Object.fromEntries(
      Object.keys(config.mcp_servers ?? {}).map((name) => [`mcp_servers.${name}.enabled`, false])
    )
  } else if (mcp) {
    const prefix = `mcp_servers.${mcp.name}`
    params.config = {
      [prefix + '.url']: mcp.url,
      [prefix + '.bearer_token_env_var']: mcp.tokenEnv,
      [prefix + '.enabled']: true
    }
  }
  options.signal.throwIfAborted()
  const bindReply = (thread: z.output<(typeof responses)['thread/start']>) => {
    options.signal.throwIfAborted()
    if (headless && (thread.approvalPolicy !== 'never' || thread.sandbox?.type !== 'readOnly'))
      throw new Error('Codex could not establish a read-only scheduled task session')
    bind(describeThread(params, models, headless, thread))
  }
  if (restore) {
    bind(describeThread(params, models, headless, { thread: { id: restore.threadId } }))
    try {
      await server.request(
        'thread/resume',
        {
          ...params,
          threadId: restore.threadId,
          ...(server.atLeast(125) && { excludeTurns: true })
        },
        (thread) => {
          if (thread.thread.id !== restore.threadId) throw new Error('Codex resumed a different thread')
          bindReply(thread)
        }
      )
      return
    } catch (error) {
      if (!isMissingThread(error, restore.threadId)) throw error
      if (restore.kind === 'required') throw new CodexRestoreError('Codex could not restore the original conversation')
      options.signal.throwIfAborted()
    }
  }
  await server.request('thread/start', params, bindReply)
}

export class CodexRestoreError extends Error {}

function isMissingThread(error: unknown, threadId: string) {
  if (!(error instanceof CodexRequestError) || error.code !== -32600) return false
  const missing = 'no rollout found for thread id ' + threadId
  return error.message === missing || error.message === 'resume failed: ' + missing
}

function describeThread(
  params: CodexRequestParams['thread/start'],
  models: Awaited<ReturnType<CodexAppServerClient['listModels']>>,
  headless: boolean,
  thread: z.output<(typeof responses)['thread/start']>
) {
  const selected = models.find((m) => (m.model ?? m.id) === thread.model)
  const initialMode: CodexMode =
    headless || thread.sandbox?.type === 'readOnly'
      ? 'readOnly'
      : thread.sandbox?.type === 'dangerFullAccess' && thread.approvalPolicy === 'never'
        ? 'fullAccess'
        : 'workspace'
  const efforts = buildCodexThoughtLevelOptions(selected?.supportedReasoningEfforts)
  const info = {
    resume: true,
    images: (selected?.inputModalities ?? ['text', 'image']).includes('image'),
    models: models.map((m) => ({ id: m.model ?? m.id, name: m.displayName })),
    activeModel: thread.model ? { id: thread.model } : undefined,
    mode: {
      id: CODEX_LOCAL_MODE_ID,
      currentValue: initialMode,
      options: CODEX_LOCAL_MODE_OPTIONS.filter((o) => !headless || o.value === 'readOnly')
    },
    thoughtLevel: {
      id: CODEX_LOCAL_THOUGHT_LEVEL_ID,
      currentValue: efforts.find((o) => o.value === thread.reasoningEffort)?.value ?? 'default',
      options: efforts
    }
  }
  return { id: thread.thread.id, params, info, collaboration: thread.collaborationMode?.mode }
}
export type OpenThread = ReturnType<typeof describeThread>
export function isMissingRollout(error: unknown) {
  return error instanceof Error && /no rollout found/i.test(error.message)
}

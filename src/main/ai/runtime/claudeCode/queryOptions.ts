import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { Options } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'

import { spawnClaudeCodeProcess } from './ClaudeCodeProcessManager'
import type { ClaudeCodeSettings } from './types'

/** An explicit child environment is authoritative, even when it omits the config override. */
export function resolveClaudeConfigDirectory(env?: Options['env']): string {
  return (
    (env === undefined ? process.env.CLAUDE_CONFIG_DIR : env.CLAUDE_CONFIG_DIR) ??
    application.getPath('external.claude.config')
  )
}

export interface ClaudeCodeQueryOptionsInput {
  modelId: string
  settings: ClaudeCodeSettings
  abortController?: AbortController
  responseFormat?: Parameters<LanguageModelV3['doStream']>[0]['responseFormat']
  effectiveResume?: string
}

export function createClaudeCodeQueryOptions({
  modelId,
  settings,
  abortController,
  responseFormat,
  effectiveResume
}: ClaudeCodeQueryOptionsInput): Options {
  const {
    // oxlint-disable-next-line no-unused-vars
    approvalEmitter: _approvalEmitter,
    // oxlint-disable-next-line no-unused-vars
    warmQueryKey: _warmQueryKey,
    // oxlint-disable-next-line no-unused-vars
    toolPolicySnapshot: _toolPolicySnapshot,
    // oxlint-disable-next-line no-unused-vars
    warmQueryInitializeTimeoutMs: _warmQueryInitializeTimeoutMs,
    // oxlint-disable-next-line no-unused-vars
    mcpToolMetadata: _mcpToolMetadata,
    ...settingsRest
  } = settings

  const opts: Partial<Options> = {
    ...settingsRest,
    // The SDK requires this launch flag for a confirmed mid-turn switch to Full Access.
    allowDangerouslySkipPermissions: true,
    spawnClaudeCodeProcess,
    model: modelId,
    // The driver exposes a per-task Stop wired to `stop_task`. Without this declaration the CLI
    // fails closed and an ordinary interrupt kills every running background task with the turn.
    // Set it here so cold starts and prewarmed queries share the same contract.
    perTaskStopAffordance: true,
    ...(abortController ? { abortController } : {}),
    resume: effectiveResume ?? settings.resume
  }

  if (responseFormat?.type === 'json' && responseFormat.schema) {
    opts.outputFormat = {
      type: 'json_schema',
      schema: responseFormat.schema as Record<string, unknown>
    }
  }

  return opts
}

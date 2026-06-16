import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { Options } from '@anthropic-ai/claude-agent-sdk'

import type { ClaudeCodeSettings } from './types'

export interface ClaudeCodeQueryOptionsInput {
  modelId: string
  settings: ClaudeCodeSettings
  abortController?: AbortController
  responseFormat?: Parameters<LanguageModelV3['doStream']>[0]['responseFormat']
  stderrCollector?: (data: string) => void
  effectiveResume?: string
}

export function createClaudeCodeQueryOptions({
  modelId,
  settings,
  abortController,
  responseFormat,
  stderrCollector,
  effectiveResume
}: ClaudeCodeQueryOptionsInput): Options {
  const {
    // oxlint-disable-next-line no-unused-vars
    approvalEmitter: _approvalEmitter,
    // oxlint-disable-next-line no-unused-vars
    steerHolder: _steerHolder,
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
    model: modelId,
    ...(abortController ? { abortController } : {}),
    resume: effectiveResume ?? settings.resume
  }

  const userStderrCallback = settings.stderr
  if (stderrCollector || userStderrCallback) {
    opts.stderr = (data: string) => {
      if (stderrCollector) stderrCollector(data)
      if (userStderrCallback) userStderrCallback(data)
    }
  }

  if (responseFormat?.type === 'json' && responseFormat.schema) {
    opts.outputFormat = {
      type: 'json_schema',
      schema: responseFormat.schema as Record<string, unknown>
    }
  }

  return opts as Options
}

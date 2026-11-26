import { randomUUID } from 'node:crypto'

import * as z from 'zod'

import { acpConfigRecord, type AcpGatewayConfig, type TomlModelProfile } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpHarnessAdapter, AcpTurnUsage } from '@cherrystudio/agent-runtime-acp/v1'

import { setGrokAuxiliaryModels } from './cli'
import { grokInteractions, type GrokInteractionHost } from './interactions'

const tokens = z.number().int().nonnegative()
const grokUsage = z
  .object({
    inputTokens: tokens,
    outputTokens: tokens,
    totalTokens: tokens.nullish(),
    cachedReadTokens: tokens.nullish(),
    cachedWriteTokens: tokens.nullish(),
    cacheCreationTokens: tokens.nullish(),
    thoughtTokens: tokens.nullish(),
    reasoningTokens: tokens.nullish()
  })
  .transform(
    (usage): AcpTurnUsage => ({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
      cachedReadTokens: usage.cachedReadTokens,
      cachedWriteTokens: usage.cachedWriteTokens ?? usage.cacheCreationTokens,
      thoughtTokens: usage.thoughtTokens ?? usage.reasoningTokens
    })
  )

const sessionNotification = z.object({
  sessionId: z.string(),
  _meta: z.object({ isReplay: z.boolean().optional() }).nullish(),
  update: z.object({
    sessionUpdate: z.string(),
    prompt_id: z.string().nullish(),
    promptId: z.string().nullish(),
    usage: z.unknown().optional()
  })
})

interface PendingPrompt {
  readonly sessionId: string
  usage?: AcpTurnUsage
}

const registerPromptUsage: NonNullable<AcpHarnessAdapter['registerPromptUsage']> = (host) => {
  const pending = new Map<string, PendingPrompt>()

  function onNotification({ sessionId, update, _meta }: z.infer<typeof sessionNotification>) {
    if (_meta?.isReplay || update.sessionUpdate !== 'turn_completed') return
    const promptId = update.prompt_id ?? update.promptId
    const prompt = promptId ? pending.get(promptId) : undefined
    if (!prompt || prompt.sessionId !== sessionId) return
    const parsed = grokUsage.safeParse(update.usage)
    if (parsed.success) prompt.usage = parsed.data
  }

  for (const method of ['_x.ai/session_notification', '_x.ai/session/update', 'x.ai/session_notification']) {
    host.onNotification(method, sessionNotification, onNotification)
  }

  return (sessionId) => {
    const promptId = randomUUID()
    const prompt: PendingPrompt = { sessionId }
    pending.set(promptId, prompt)
    return {
      metadata: { promptId },
      read({ _meta }) {
        const ledger = grokUsage.safeParse(_meta?.usage).data
        if (ledger) return ledger
        const responseId = _meta?.promptId ?? _meta?.requestId
        return responseId == null || responseId === promptId ? prompt.usage : undefined
      },
      release() {
        pending.delete(promptId)
      }
    }
  }
}

const prediction = z.object({ generation: z.number().int().nonnegative(), suggestion: z.string().nullable() })

export function createGrokAcpAdapter(host: GrokInteractionHost): AcpHarnessAdapter {
  return {
    registerPromptUsage,
    registerRequests: grokInteractions(host),
    bind({ agent, sessionId }) {
      let generation = 0
      let unavailable = false
      return {
        async predictPrompt(signal) {
          if (unavailable || signal.aborted) return ''
          const requested = ++generation
          try {
            const result = prediction.parse(
              await agent.request(
                '_x.ai/suggestPrompt',
                { sessionId, generation: requested },
                {
                  cancellationSignal: signal,
                  stopWaitingOnCancel: true
                }
              )
            )
            return !signal.aborted && requested === generation && result.generation === requested
              ? (result.suggestion ?? '')
              : ''
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === -32601)) throw error
            unavailable = true
            return ''
          }
        }
      }
    }
  }
}

export const grokGateway = {
  format: 'toml',
  read(doc, model) {
    const entry = acpConfigRecord(acpConfigRecord(doc.model)?.[model])
    if (!entry) return
    return {
      baseUrl: entry.base_url,
      apiKey: entry.api_key,
      model: entry.model,
      path: entry.api_backend === 'responses' ? '/v1/responses' : '/v1/chat/completions'
    }
  }
} satisfies AcpGatewayConfig

export const grokModelProfile = {
  format: 'toml',
  target: 'grok-config',
  readModel(doc) {
    const value = acpConfigRecord(doc.models)?.default
    return typeof value === 'string' ? value : undefined
  },
  writeModel(doc, model) {
    const models = { ...acpConfigRecord(doc.models) }
    const summary = model && `${model}-session-summary`
    setGrokAuxiliaryModels(models, model, summary && acpConfigRecord(doc.model)?.[summary] ? summary : model)
    if (model === undefined) delete models.default
    else models.default = model
    if (Object.keys(models).length) doc.models = models
    else delete doc.models
  }
} satisfies TomlModelProfile<'grok-config'>

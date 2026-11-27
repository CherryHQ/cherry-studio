import { randomUUID } from 'node:crypto'

import * as z from 'zod'

import { acpConfigRecord, type TomlModelProfile } from '@cherrystudio/agent-runtime-acp/profile'
import type {
  AcpHarnessAdapter,
  AcpHarnessSession,
  AcpModelCatalogReader,
  AcpTurnUsage
} from '@cherrystudio/agent-runtime-acp/v1'

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
    usage: z.unknown().optional(),
    stop_reason: z.string().optional(),
    agent_result: z.string().optional()
  })
})

interface PendingPrompt {
  readonly sessionId: string
  usage?: AcpTurnUsage
}

const registerProtocol: NonNullable<AcpHarnessAdapter['registerProtocol']> = (host) => {
  const pending = new Map<string, PendingPrompt>()
  const ownPromptPrefix = `cherry-${randomUUID()}:`
  host.onNotification(
    '_x.ai/queue/changed',
    z.object({
      sessionId: z.string(),
      runningPromptId: z.string().nullish(),
      _meta: z.object({ isReplay: z.boolean().optional() }).nullish()
    }),
    ({ sessionId, runningPromptId, _meta }) => {
      if (!_meta?.isReplay && runningPromptId && !runningPromptId.startsWith(ownPromptPrefix))
        host.nativeTurn({ state: 'started', sessionId, id: runningPromptId })
    }
  )

  function onNotification({ sessionId, update, _meta }: z.infer<typeof sessionNotification>) {
    if (_meta?.isReplay || update.sessionUpdate !== 'turn_completed') return
    const promptId = update.prompt_id ?? update.promptId
    if (!promptId) return
    const usage = grokUsage.safeParse(update.usage).data
    if (!promptId.startsWith(ownPromptPrefix)) {
      host.nativeTurn({
        state: 'finished',
        sessionId,
        id: promptId,
        ...(usage && { usage }),
        ...(update.stop_reason === 'cancelled' && { cancelled: true }),
        ...(update.stop_reason === 'error' && { error: update.agent_result || 'Grok native turn failed' })
      })
      return
    }
    const prompt = pending.get(promptId)
    if (!prompt || prompt.sessionId !== sessionId) return
    if (usage) prompt.usage = usage
  }

  for (const method of ['_x.ai/session_notification', '_x.ai/session/update', 'x.ai/session_notification']) {
    host.onNotification(method, sessionNotification, onNotification)
  }

  return (sessionId) => {
    const promptId = `${ownPromptPrefix}${randomUUID()}`
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

const modelState = z.object({
  currentModelId: z.string().optional(),
  availableModels: z.array(
    z.object({
      modelId: z.string(),
      name: z.string().optional(),
      description: z.string().nullish().catch(undefined),
      hidden: z.boolean().optional(),
      user_selectable: z.boolean().optional(),
      userSelectable: z.boolean().optional(),
      _meta: z
        .looseObject({
          supportsReasoningEffort: z.boolean().optional(),
          reasoningEffort: z.string().optional(),
          reasoningEfforts: z
            .array(
              z.looseObject({
                id: z.string().optional(),
                value: z.string().optional(),
                label: z.string().optional(),
                description: z.string().nullish(),
                default: z.boolean().optional()
              })
            )
            .optional()
        })
        .nullish()
    })
  )
})

function grokEffort(metadata: z.output<typeof modelState>['availableModels'][number]['_meta']) {
  if (!metadata?.reasoningEfforts?.length || metadata.supportsReasoningEffort === false) return
  const options = metadata.reasoningEfforts.flatMap((option) => {
    const value = option.value ?? option.id
    return value ? [{ value, name: option.label || value, description: option.description ?? undefined }] : []
  })
  if (!options.length) return
  const nativeDefault = metadata.reasoningEfforts.find((option) => option.default)
  return { options, defaultValue: nativeDefault?.value ?? nativeDefault?.id }
}

const listModelsResponse = z.union([z.object({ result: modelState }).transform(({ result }) => result), modelState])

export const readGrokModelCatalog: AcpModelCatalogReader = async (agent) => {
  let response: unknown
  try {
    response = await agent.request('_x.ai/models/list', {})
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === -32601) return
    throw error
  }
  const { currentModelId, availableModels } = listModelsResponse.parse(response)
  return {
    models: availableModels
      .filter((model) => !model.hidden && model.user_selectable !== false && model.userSelectable !== false)
      .map(({ modelId, name, description, _meta }) => {
        const effort = grokEffort(_meta)
        return {
          id: modelId,
          name: name || modelId,
          ...(description != null && { description }),
          ...(_meta != null && { _meta }),
          ...(effort && { effort })
        }
      }),
    activeModel: currentModelId ? { id: currentModelId } : undefined
  }
}

function bindLegacyEffort({
  agent,
  sessionId,
  currentModel,
  legacyModelState
}: Parameters<NonNullable<AcpHarnessAdapter['bind']>>[0]) {
  const models = modelState.safeParse(legacyModelState).data?.availableModels
  if (!models) return
  let applied: { modelId: string; value: string } | undefined
  const read = () => {
    const modelId = currentModel()
    if (!modelId) return
    const metadata = models.find((model) => model.modelId === modelId)?._meta
    const effort = grokEffort(metadata)
    if (!effort) return
    const value = applied?.modelId === modelId ? applied.value : metadata?.reasoningEffort
    return {
      id: 'grok-legacy-effort',
      modelId,
      application: 'session' as const,
      currentValue: value ?? effort.defaultValue ?? 'default',
      options: effort.options
    }
  }
  return {
    read,
    async set(value: string) {
      const effort = read()
      if (!effort?.options.some((option) => option.value === value)) throw new Error('Grok effort is unavailable')
      await agent.request('session/set_model', {
        sessionId,
        modelId: effort.modelId,
        _meta: { reasoningEffort: value }
      })
      applied = { modelId: effort.modelId, value }
    }
  }
}

const interjectionResponse = z.object({ status: z.literal('queued') })
const compactResponse = z.record(z.string(), z.unknown())
const rpcError = z.object({ code: z.number(), data: z.object({ kind: z.string() }).optional() })

function bindGrokControls({
  agent,
  sessionId
}: Parameters<NonNullable<AcpHarnessAdapter['bind']>>[0]): Pick<AcpHarnessSession, 'steer' | 'compact'> {
  return {
    steer: {
      whenIdle: 'reject',
      async submit({ inputId, content }) {
        try {
          const text = content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
          const response = await agent.request('_x.ai/interject', {
            sessionId,
            text,
            interjectionId: inputId,
            ...(content.some((part) => part.type !== 'text') && { content })
          })
          if (interjectionResponse.safeParse(response).success)
            return { status: 'acknowledged', inputId, facts: ['accepted', 'queued'] }
        } catch (error) {
          const code = rpcError.safeParse(error).data?.code
          if (code === -32601 || code === -32602)
            return {
              status: 'rejected',
              inputId,
              error: { operation: 'steer', code: 'refused', message: 'Grok refused the interjection' }
            }
        }
        return {
          status: 'unknown',
          inputId,
          error: { operation: 'steer', code: 'missing-receipt', message: 'Grok did not confirm interjection admission' }
        }
      }
    },
    async compact() {
      try {
        const response = await agent.request('_x.ai/compact_conversation', { sessionId })
        if (compactResponse.safeParse(response).success) return { status: 'confirmed', value: undefined }
      } catch (error) {
        const native = rpcError.safeParse(error).data
        const kind = native?.data?.kind
        if (
          kind === 'compact_failed' ||
          kind === 'compact_cancelled' ||
          native?.code === -32601 ||
          native?.code === -32602
        )
          return {
            status: 'rejected',
            error: {
              operation: 'compact',
              code: kind ?? 'refused',
              message: error instanceof Error ? error.message : 'Grok refused compaction'
            }
          }
      }
      return {
        status: 'unknown',
        error: { operation: 'compact', code: 'missing-receipt', message: 'Grok did not confirm compaction' }
      }
    }
  }
}

export function createGrokAcpAdapter(host: GrokInteractionHost): AcpHarnessAdapter {
  return {
    registerProtocol,
    registerRequests: grokInteractions(host),
    bind(input) {
      const { agent, sessionId } = input
      let generation = 0
      let unavailable = false
      return {
        legacyEffort: bindLegacyEffort(input),
        ...bindGrokControls(input),
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

export { readGrokAccount, readGrokSubscriptionUsage } from './accountUsage'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { resolveModelTokenDialect } from '@main/ai/tokens/dialect'
import { getTextTokenizer } from '@main/ai/tokens/profiles'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { DREAMING_INSTRUCTIONS } from './memoryDreamingPlan'
import type { DreamingState } from './memoryDreamingState'
import type { MemoryRead } from './MemoryStore'

export class DreamingError extends Error {
  constructor(
    readonly reason: NonNullable<DreamingState['reason']>,
    readonly unfit: readonly MemoryRead[] = []
  ) {
    super(`Memory organization requires attention: ${reason}`)
  }
}

export async function resolveDreamingModel() {
  try {
    const id = application.get('PreferenceService').get('chat.default_model_id') as UniqueModelId | null
    if (!id) throw new DreamingError('model')
    const { providerId, modelId } = parseUniqueModelId(id)
    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)
    if (!provider.isEnabled || !model.isEnabled) throw new DreamingError('model')
    if (!model.contextWindow || model.contextWindow < 4096) throw new DreamingError('budget')
    const tokenizer = await getTextTokenizer(resolveModelTokenDialect(provider, model))
    return { id, provider, model, tokenizer }
  } catch (error) {
    throw error instanceof DreamingError ? error : new DreamingError('model')
  }
}

export function fitDreamingInputs(
  candidates: readonly MemoryRead[],
  resolved: Awaited<ReturnType<typeof resolveDreamingModel>>
) {
  const fit = (inputs: MemoryRead[]) => {
    const prompt = JSON.stringify({ files: inputs.map(({ path, content }) => ({ path, content })) })
    const contentTokens = inputs.reduce((total, file) => total + resolved.tokenizer.count(file.content ?? ''), 0)
    const outputTokens = Math.max(2048, Math.ceil(contentTokens * 2 + 1024))
    const inputTokens = Math.ceil(resolved.tokenizer.count(DREAMING_INSTRUCTIONS + prompt) * 1.25 + 512)
    const bytes = inputs.reduce((total, file) => total + Buffer.byteLength(file.content ?? '', 'utf8'), 0)
    if (
      bytes <= 50_000 &&
      inputs.length <= 10 &&
      outputTokens <= (resolved.model.maxOutputTokens ?? 4096) &&
      inputTokens <= (resolved.model.maxInputTokens ?? resolved.model.contextWindow!) &&
      inputTokens + outputTokens <= resolved.model.contextWindow!
    )
      return { inputs, prompt, outputTokens }
    return undefined
  }
  const entry = candidates[0]
  let batch = entry && fit([entry])
  if (!batch) throw new DreamingError('budget', entry ? [entry] : [])
  const unfit: MemoryRead[] = []
  for (const candidate of candidates.slice(1)) {
    const combined = fit([...batch.inputs, candidate])
    if (combined) batch = combined
    else if (!fit([entry, candidate])) unfit.push(candidate)
  }
  return { ...batch, unfit }
}

export async function generateDreamingPlan(
  jobId: string,
  resolved: Awaited<ReturnType<typeof resolveDreamingModel>>,
  batch: ReturnType<typeof fitDreamingInputs>,
  signal: AbortSignal
): Promise<string> {
  const result = await application.get('AiService').generateText({
    uniqueModelId: resolved.id,
    resolvedModel: { provider: resolved.provider, model: resolved.model },
    conversation: { id: `memory-dreaming:${jobId}` },
    system: DREAMING_INSTRUCTIONS,
    prompt: batch.prompt,
    disableTools: true,
    contextOwner: 'caller',
    callOverrides: { maxOutputTokens: batch.outputTokens },
    requestOptions: { signal, maxRetries: 0 }
  })
  if (result.finishReason !== 'stop' || Buffer.byteLength(result.text, 'utf8') > 550_000)
    throw new DreamingError('output')
  return result.text
}

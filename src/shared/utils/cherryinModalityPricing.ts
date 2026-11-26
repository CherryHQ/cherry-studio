import { isPlainObject } from 'es-toolkit'

import { getCherryInGeminiModalityRates } from './providerBillingDefaults'

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function countModality(details: unknown, modality: string, total: number): number | undefined {
  if (details === undefined || details === null) return total === 0 ? 0 : undefined
  if (!Array.isArray(details)) return undefined

  let allTokens = 0
  let modalityTokens = 0
  for (const detail of details) {
    if (!isPlainObject(detail) || typeof detail.modality !== 'string') return undefined
    const tokens = count(detail.tokenCount)
    if (tokens === undefined) return undefined
    allTokens += tokens
    if (detail.modality === modality) modalityTokens += tokens
  }
  return allTokens === total ? modalityTokens : undefined
}

export function readNativeGeminiTokenUsage(raw: unknown) {
  if (!isPlainObject(raw)) return undefined
  const prompt = count(raw.promptTokenCount)
  const tool = count(raw.toolUsePromptTokenCount ?? 0)
  const candidates = count(raw.candidatesTokenCount ?? 0)
  const reasoning = count(raw.thoughtsTokenCount ?? 0)
  const cached = count(raw.cachedContentTokenCount ?? 0)
  if (
    prompt === undefined ||
    tool === undefined ||
    candidates === undefined ||
    reasoning === undefined ||
    cached === undefined
  )
    return undefined
  const input = prompt + tool
  const output = candidates + reasoning
  if (cached > input || (raw.totalTokenCount != null && raw.totalTokenCount !== input + output)) return undefined
  return { raw, prompt, tool, candidates, reasoning, cached, input, output }
}

function readGeminiModalityUsage(raw: unknown, rates: NonNullable<ReturnType<typeof getCherryInGeminiModalityRates>>) {
  const native = readNativeGeminiTokenUsage(raw)
  if (native) {
    const promptAudio = rates.audioInput ? countModality(native.raw.promptTokensDetails, 'AUDIO', native.prompt) : 0
    const toolAudio = rates.audioInput ? countModality(native.raw.toolUsePromptTokensDetails, 'AUDIO', native.tool) : 0
    return {
      input: native.input,
      output: native.output,
      cacheRead: native.cached,
      audio: promptAudio === undefined || toolAudio === undefined ? undefined : promptAudio + toolAudio,
      images: rates.imageOutput ? countModality(native.raw.candidatesTokensDetails, 'IMAGE', native.candidates) : 0
    }
  }
  if (!isPlainObject(raw)) return undefined
  const input = count(raw.prompt_tokens)
  const output = count(raw.completion_tokens)
  if (input === undefined || output === undefined) return undefined
  const prompt = isPlainObject(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined
  const completion = isPlainObject(raw.completion_tokens_details) ? raw.completion_tokens_details : undefined
  return {
    input,
    output,
    cacheRead: count(prompt?.cached_tokens ?? 0),
    audio: rates.audioInput && input > 0 ? count(prompt?.audio_tokens) : 0,
    images: rates.imageOutput && output > 0 ? count(completion?.image_tokens) : 0
  }
}

export function computeCherryInGeminiModalityCost(modelId: string, raw: unknown) {
  const rates = getCherryInGeminiModalityRates(modelId)
  if (!rates) return undefined
  const usage = readGeminiModalityUsage(raw, rates)
  if (!usage || usage.audio === undefined || usage.images === undefined || usage.cacheRead === undefined)
    return undefined
  const cached = rates.cacheRead === undefined ? 0 : usage.cacheRead
  const textInput = usage.input - cached - usage.audio
  const textOutput = usage.output - usage.images
  if (usage.cacheRead > usage.input || textInput < 0 || textOutput < 0) return undefined

  const input = (textInput * rates.input + usage.audio * (rates.audioInput ?? 0)) / 1_000_000
  const outputRate = usage.images === 0 ? (rates.outputWithoutImage ?? rates.output) : rates.output
  const output = (textOutput * outputRate) / 1_000_000
  const cacheRead = (cached * (rates.cacheRead ?? 0)) / 1_000_000
  const image = (usage.images * (rates.imageOutput ?? 0)) / 1_000_000
  return { amount: input + output + cacheRead + image, breakdown: { input, output, cacheRead, image } }
}

export function readOpenAIImageTokenUsage(raw: unknown) {
  if (!isPlainObject(raw)) return undefined
  const input = count(raw.input_tokens ?? raw.prompt_tokens)
  const output = count(raw.output_tokens ?? raw.completion_tokens)
  if (input === undefined || input === 0 || output === undefined) return undefined
  const details = raw.input_tokens_details ?? raw.prompt_tokens_details
  if (details != null && !isPlainObject(details)) return undefined
  const cached = count(details?.cached_tokens ?? 0)
  const images = count(details?.image_tokens ?? 0)
  if (cached === undefined || images === undefined || cached > input || images > input) return undefined
  const total = count(raw.total_tokens ?? input + output)
  if (total !== input + output || total === 0) return undefined
  return { input, output, total, images, cached }
}

export function computeCherryInOpenAIImageCost(raw: unknown) {
  const usage = readOpenAIImageTokenUsage(raw)
  if (!usage) return undefined

  // The public expression applies cached tokens to text input first.
  const text = usage.input - usage.images
  const cachedImage = Math.max(0, usage.cached - text)
  const input = Math.max(0, text * 5 + usage.images * 8 - usage.cached * 3.75 - cachedImage * 2.25) / 1_000_000
  const image = (usage.output * 30) / 1_000_000
  return { amount: input + image, breakdown: { input, image } }
}

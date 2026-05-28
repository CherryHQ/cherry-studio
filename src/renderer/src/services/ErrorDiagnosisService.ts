import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import { loggerService } from '@renderer/services/LoggerService'
import store from '@renderer/store'
import type { Model } from '@renderer/types'
import type { SerializedError } from '@renderer/types/error'

import { fetchGenerate, fetchModels } from './ApiService'

const logger = loggerService.withContext('ErrorDiagnosisService')

export interface DiagnosisStep {
  text: string
}

export interface DiagnosisResult {
  summary: string
  category: string
  explanation: string
  steps: DiagnosisStep[]
}

export interface DiagnosisContext {
  errorSource?: string
  providerName?: string
  modelId?: string
}

async function getCherryAiFreeModel(): Promise<Model | undefined> {
  try {
    const models = await fetchModels(CHERRYAI_PROVIDER)
    return models.length > 0 ? models[0] : undefined
  } catch {
    logger.warn('Failed to fetch CherryAI free models')
    return undefined
  }
}

async function buildModelsToTry(context?: DiagnosisContext): Promise<Model[]> {
  const defaultModel = store.getState().llm.defaultModel
  const models: Model[] = []

  // CherryAI free model as primary diagnosis model
  const cherryModel = await getCherryAiFreeModel()
  if (cherryModel) {
    models.push(cherryModel)
  }

  // User's default model as fallback (skip if same as failing model)
  if (defaultModel && defaultModel.id !== context?.modelId && !models.some((m) => m.id === defaultModel.id)) {
    models.push(defaultModel)
  }

  return models
}

function buildContextHint(errorInfo: Record<string, unknown>, context?: DiagnosisContext): string {
  const msg = String(errorInfo.message || '').toLowerCase()
  const status = Number(errorInfo.status) || 0
  const finishReason = String(errorInfo.finishReason ?? '').toLowerCase()
  const source = context?.errorSource || String(errorInfo.source || '')

  // Structured safety signal — finishReason takes precedence over message text
  if (finishReason === 'safety' || finishReason === 'recitation' || finishReason === 'content_filter') {
    return `## Context\nThe provider's safety system blocked this response (finishReason=${finishReason}). Suggest rephrasing the prompt or removing sensitive content. DO NOT suggest checking the API key or billing.\n`
  }

  // Region / geo-block — check BEFORE auth, since 403 with region keywords is not an API-key issue
  if (
    msg.includes('unsupported_country') ||
    msg.includes('country, region') ||
    msg.includes('country/region') ||
    msg.includes('region not supported') ||
    msg.includes('not available in your') ||
    msg.includes('geographic') ||
    msg.includes('geo-block') ||
    msg.includes('geo block') ||
    (msg.includes('territory') && (status === 403 || msg.includes('unsupported')))
  ) {
    const provider = errorInfo.provider || context?.providerName || 'the provider'
    return `## Context\n${provider} is blocking the request because the user's IP region is not supported. This is NOT an API-key issue. Suggest configuring an HTTP/SOCKS proxy in general settings, or switching to a provider available in the user's region. DO NOT suggest changing the API key.\n`
  }

  // Auth / API key issues
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('api_key') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden')
  ) {
    const provider = errorInfo.provider || context?.providerName || 'the provider'
    return `## Context\nThe user is calling ${provider} API and got an authentication error. Cherry Studio lets users configure API keys per provider in provider settings.\n`
  }

  // Quota / balance exhausted — check first so a 429 with "insufficient" routes here, not to rate_limit.
  // HTTP 402 Payment Required is the canonical billing-failure status.
  if (
    status === 402 ||
    msg.includes('quota') ||
    msg.includes('insufficient') ||
    msg.includes('billing') ||
    msg.includes('payment') ||
    msg.includes('balance') ||
    msg.includes('credit')
  ) {
    const provider = errorInfo.provider || context?.providerName || 'the provider'
    return `## Context\nThe user's quota or account balance is exhausted on ${provider}. Suggest checking billing on the provider's website, topping up, or switching to a different provider. DO NOT suggest waiting or retrying — this is not a transient issue.\n`
  }

  // Rate limit (high-frequency requests)
  if (status === 429 || msg.includes('rate_limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
    const provider = errorInfo.provider || context?.providerName || 'the provider'
    return `## Context\nThe user is hitting a rate limit on ${provider} due to too many requests in a short window. This is NOT a billing or quota issue — the user has not run out of credit. Suggest waiting briefly before retrying, slowing down request frequency, or switching to a model with a higher rate limit. DO NOT mention billing, recharging, top-up, or running out of quota.\n`
  }

  // Model not found
  if (status === 404 || msg.includes('model_not_found') || msg.includes('model not found')) {
    const model = errorInfo.modelId || context?.modelId || 'unknown'
    return `## Context\nModel "${model}" was not found. The model may be deprecated, the ID may be wrong, or the user's API plan may not include this model.\n`
  }

  // Content filter / safety — provider-agnostic
  if (
    msg.includes('content_filter') ||
    msg.includes('content_policy') ||
    msg.includes('prohibited_content') ||
    msg.includes('responsible_ai') ||
    msg.includes('output_blocked') ||
    msg.includes('"safety"') ||
    msg.includes('recitation') ||
    msg.includes('blocked by safety')
  ) {
    return `## Context\nThe provider's safety system blocked this request or response due to content policy. Suggest rephrasing the prompt, removing sensitive content, or switching to a model with looser safety filters. DO NOT suggest checking the API key or billing.\n`
  }

  // MCP — check BEFORE network so "MCP timeout" routes here
  if (msg.includes('mcp')) {
    return `## Context\nMCP (Model Context Protocol) server error. Users manage MCP servers in MCP settings. Common issues: server not started, wrong configuration, connection timeout.\n`
  }

  // Context length
  if (
    msg.includes('context_length') ||
    msg.includes('context window') ||
    msg.includes('prompt is too long') ||
    msg.includes('input is too long') ||
    msg.includes('too many tokens')
  ) {
    return `## Context\nThe prompt exceeds the model's context window. Suggest clearing chat history, removing large attachments, or switching to a model with a larger context window. DO NOT suggest checking the API key.\n`
  }

  // Network / proxy
  if (
    msg.includes('econnrefused') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('proxy') ||
    msg.includes('certificate')
  ) {
    return `## Context\nNetwork or proxy error. Cherry Studio supports HTTP/SOCKS proxy configuration in general settings. The user may be behind a firewall or using a custom API endpoint.\n`
  }

  // Knowledge base
  if (msg.includes('embedding') || msg.includes('knowledge base')) {
    return `## Context\nKnowledge base / embedding error. Users create knowledge bases with documents and use embedding models for retrieval.\n`
  }

  // Generic
  return `## Context\nCherry Studio is an AI chat app connecting to LLM providers (OpenAI, Anthropic, Google, Ollama, etc.) with API keys. Error occurred during ${source || 'chat'}.\n`
}

function parseResponse(raw: string): DiagnosisResult {
  // Strip markdown code blocks if AI wraps response in ```json ... ```
  let cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')

  // Try to extract JSON object if model returned extra text around it
  if (!cleaned.trimStart().startsWith('{')) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      cleaned = jsonMatch[0]
    }
  }

  const parsed = JSON.parse(cleaned) as DiagnosisResult

  if (!parsed.summary || !Array.isArray(parsed.steps)) {
    throw new Error('Invalid diagnosis response format')
  }

  return {
    summary: parsed.summary,
    category: parsed.category || 'unknown',
    explanation: parsed.explanation || parsed.summary,
    steps: parsed.steps.map((s) => ({ text: typeof s === 'string' ? s : s.text }))
  }
}

export async function diagnoseError(
  error: SerializedError,
  language: string,
  context?: DiagnosisContext
): Promise<DiagnosisResult> {
  const errorBag = error as Record<string, unknown>
  const errorInfo: Record<string, unknown> = {
    name: error.name,
    message: error.message
  }

  const status = errorBag.statusCode ?? errorBag.status
  if (status) errorInfo.status = status

  if (context?.errorSource) errorInfo.source = context.errorSource

  // Provider/model: prefer context, fall back to fields on the error itself
  const provider = context?.providerName ?? errorBag.provider ?? errorBag.providerId
  if (typeof provider === 'string' && provider) errorInfo.provider = provider

  const modelId = context?.modelId ?? errorBag.modelId
  if (typeof modelId === 'string' && modelId) errorInfo.modelId = modelId

  // cause: SerializedAiSdkError serializes cause to a string wrapper
  const cause = errorBag.cause
  if (cause && typeof cause === 'string') {
    errorInfo.cause = cause.slice(0, 400)
  }

  // responseBody: the actual provider error JSON — the highest-signal field for diagnosis
  const responseBody = errorBag.responseBody
  if (responseBody && typeof responseBody === 'string') {
    errorInfo.responseBody = responseBody.slice(0, 800)
  }

  // data: parsed structured error data (some SDKs)
  const data = errorBag.data
  if (data !== undefined && data !== null) {
    try {
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data)
      if (dataStr) errorInfo.data = dataStr.slice(0, 400)
    } catch {
      // ignore non-serializable data
    }
  }

  // finishReason: SAFETY / RECITATION / MAX_TOKENS from NoObjectGeneratedError — structured safety signal
  const finishReason = errorBag.finishReason
  if (finishReason && typeof finishReason === 'string') {
    errorInfo.finishReason = finishReason
  }

  const url = errorBag.url
  if (url && typeof url === 'string') {
    // Include API endpoint (strip query params for privacy)
    try {
      const parsed = new URL(url)
      errorInfo.endpoint = `${parsed.origin}${parsed.pathname}`
    } catch {
      // ignore invalid URLs
    }
  }

  // Build context hint based on error source
  const contextHint = buildContextHint(errorInfo, context)

  const prompt = `You are an error diagnosis assistant for Cherry Studio, an AI chat desktop app.
Analyze the error and return a JSON diagnosis in ${language}.

${contextHint}
## Output
Return ONLY valid JSON (no markdown, no code blocks):
{"summary":"one-line","category":"auth|region|quota|rate_limit|model|network|proxy|content|server|context_length|payload|stream|parse|mcp|knowledge|ocr|deprecated|unknown","explanation":"2-3 sentences why this happened","steps":[{"text":"step 1"},{"text":"step 2"}]}

## Rules
- 2-4 concrete steps, reference actual provider/model name from error
- No URLs, no links, no restart suggestion, plain text only
- Distinguish rate_limit (too many requests, transient, retry soon) from quota (billing/balance exhausted, NOT transient, must top up)
- Distinguish region (geo-block, fix by proxy/switching provider) from auth (API key issue) — never tell a geo-blocked user to check the API key
- For content (safety filter), suggest rephrasing, never billing/auth fixes

## Examples
Input: {"name":"APICallError","message":"invalid_api_key","status":401,"provider":"openai","modelId":"gpt-4"}
Output: {"summary":"OpenAI API key is invalid or expired","category":"auth","explanation":"The OpenAI server rejected the request because the API key is invalid, expired, or has been revoked.","steps":[{"text":"Open provider settings and check your OpenAI API key is correct"},{"text":"Verify the API key is still active in your OpenAI dashboard"}]}

Input: {"name":"APICallError","message":"Rate limit exceeded","status":429,"provider":"openai","modelId":"gpt-4"}
Output: {"summary":"OpenAI rate limit hit due to too many requests","category":"rate_limit","explanation":"The OpenAI server is throttling because the request rate exceeded the allowed limit for this model. This is not a billing issue.","steps":[{"text":"Wait a few seconds before sending the next request"},{"text":"Slow down concurrent or repeated requests to gpt-4"},{"text":"Switch to a model with a higher rate limit if this happens often"}]}

Input: {"name":"APICallError","message":"insufficient_quota: You exceeded your current quota","status":429,"provider":"openai"}
Output: {"summary":"OpenAI account balance is exhausted","category":"quota","explanation":"The OpenAI account has run out of available credit or quota, so further requests are rejected until the balance is topped up.","steps":[{"text":"Check the billing page of your OpenAI account and top up credit"},{"text":"Switch to another provider with available quota in provider settings"}]}`

  const content = JSON.stringify(errorInfo)

  const modelsToTry = await buildModelsToTry(context)
  let lastError: Error | null = null

  for (const model of modelsToTry) {
    try {
      const response = await fetchGenerate({ prompt, content, model })
      if (!response) {
        logger.warn(`Empty response from model ${model.id}, trying next`)
        lastError = new Error(`Empty response from model: ${model.id}`)
        continue
      }
      return parseResponse(response)
    } catch (err) {
      logger.warn(`Diagnosis failed with model ${model.id}`, err as Error)
      lastError = err as Error
      continue
    }
  }

  logger.error('All diagnosis models failed', lastError)
  throw lastError || new Error('All diagnosis models failed')
}

/**
 * Lightweight AI classification for errors that don't match any rule.
 * Returns a one-line summary in the user's language, or empty string on failure.
 */
export async function classifyErrorByAI(error: SerializedError, language: string): Promise<string> {
  const prompt = `You are an error diagnosis assistant for Cherry Studio. Summarize this error in one sentence (max 30 words) in ${language}. Return ONLY the summary text, no JSON, no markdown, no quotes.`
  const content = `Error: ${error.name}: ${error.message}`

  const modelsToTry = await buildModelsToTry()

  for (const model of modelsToTry) {
    try {
      const response = await fetchGenerate({ prompt, content, model })
      if (response?.trim()) {
        return response.trim()
      }
    } catch {
      continue
    }
  }

  return ''
}

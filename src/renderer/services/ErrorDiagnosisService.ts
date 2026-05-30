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
  const source = context?.errorSource || String(errorInfo.source || '')

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

  // Quota / rate limit
  if (status === 429 || msg.includes('quota') || msg.includes('rate_limit') || msg.includes('insufficient')) {
    const provider = errorInfo.provider || context?.providerName || 'the provider'
    return `## Context\nThe user hit a rate limit or quota issue with ${provider}. Users can check billing/quota on the provider's website or switch to a different model.\n`
  }

  // Model not found
  if (status === 404 || msg.includes('model_not_found') || msg.includes('model not found')) {
    const model = errorInfo.modelId || context?.modelId || 'unknown'
    return `## Context\nModel "${model}" was not found. The model may be deprecated, the ID may be wrong, or the user's API plan may not include this model.\n`
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

  // MCP
  if (msg.includes('mcp')) {
    return `## Context\nMCP (Model Context Protocol) server error. Users manage MCP servers in MCP settings. Common issues: server not started, wrong configuration, connection timeout.\n`
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
  const errorInfo: Record<string, unknown> = {
    name: error.name,
    message: error.message
  }

  const status = (error as Record<string, unknown>).statusCode ?? (error as Record<string, unknown>).status
  if (status) errorInfo.status = status

  if (context?.errorSource) errorInfo.source = context.errorSource
  if (context?.providerName) errorInfo.provider = context.providerName
  if (context?.modelId) errorInfo.modelId = context.modelId

  const cause = (error as Record<string, unknown>).cause
  if (cause && typeof cause === 'string') {
    errorInfo.responseBody = cause.slice(0, 800)
  }

  const url = (error as Record<string, unknown>).url
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
{"summary":"one-line","category":"auth|quota|model|network|proxy|content|server|context_length|payload|stream|parse|mcp|knowledge|ocr|deprecated|unknown","explanation":"2-3 sentences why this happened","steps":[{"text":"step 1"},{"text":"step 2"}]}

## Rules
- 2-4 concrete steps, reference actual provider/model name from error
- No URLs, no links, no restart suggestion, plain text only

## Example
Input: {"name":"APICallError","message":"invalid_api_key","status":401,"provider":"openai","modelId":"gpt-4"}
Output: {"summary":"OpenAI API key is invalid or expired","category":"auth","explanation":"The OpenAI server rejected the request because the API key is invalid, expired, or has been revoked.","steps":[{"text":"Open provider settings and check your OpenAI API key is correct"},{"text":"Verify the API key is still active in your OpenAI dashboard"}]}`

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

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
      const parsed = new URL(url as string)
      errorInfo.endpoint = `${parsed.origin}${parsed.pathname}`
    } catch {
      // ignore invalid URLs
    }
  }

  const prompt = `You are an error diagnosis assistant for Cherry Studio (an AI chat desktop app that connects to LLM providers like OpenAI, Anthropic, Google, etc.).

Your task: analyze the error below and return a JSON diagnosis in ${language}.

## Context about Cherry Studio
- Users configure AI providers (OpenAI, Anthropic, Google, Ollama, etc.) with API keys
- Each provider has multiple models (e.g. gpt-4, claude-3, gemini-pro)
- Users chat with AI models; errors occur during API calls to these providers
- Common issues: wrong API key, expired quota, model not available, network/proxy problems, content filtered by safety policy

## Output format
Return ONLY a JSON object (no markdown, no code blocks, no extra text):
{"summary":"one-line description of the error","category":"auth|quota|model|network|proxy|content|server|context_length|payload|stream|parse|mcp|knowledge|ocr|deprecated|unknown","explanation":"2-3 sentences explaining WHY this error happened in plain language the user can understand","steps":[{"text":"step 1"},{"text":"step 2"},{"text":"step 3"}]}

## Rules for steps
- Give 2-4 concrete, actionable steps
- Be specific: say "Check your OpenAI API key in provider settings" not "Check settings"
- Reference the actual provider/model name from the error when available
- Do NOT suggest restarting the app unless error is about corrupted local state
- Do NOT include any URLs or links
- Each step is plain text only

## Example
Input: {"name":"APICallError","message":"invalid_api_key","status":401,"provider":"openai","modelId":"gpt-4"}
Output: {"summary":"OpenAI API key is invalid or expired","category":"auth","explanation":"The OpenAI server rejected the request because the API key is invalid, expired, or has been revoked. This usually happens when the key was copied incorrectly or the key has been rotated.","steps":[{"text":"Open provider settings and check your OpenAI API key is correct"},{"text":"Verify the API key is still active in your OpenAI dashboard"},{"text":"If using a third-party proxy, confirm the key format matches their requirements"}]}`

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

import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import { loggerService } from '@renderer/services/LoggerService'
import store from '@renderer/store'
import type { Model } from '@renderer/types'
import type { SerializedError } from '@renderer/types/error'

import { fetchGenerate, fetchModels } from './ApiService'

const logger = loggerService.withContext('ErrorDiagnosisService')

export interface DiagnosisStep {
  text: string
  link?: string
  nav?: string
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
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')
  const parsed = JSON.parse(cleaned) as DiagnosisResult

  if (!parsed.summary || !Array.isArray(parsed.steps)) {
    throw new Error('Invalid diagnosis response format')
  }

  return {
    summary: parsed.summary,
    category: parsed.category || 'unknown',
    explanation: parsed.explanation || parsed.summary,
    steps: parsed.steps
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
    errorInfo.responseBody = cause.slice(0, 500)
  }

  const prompt = `You are an error diagnosis assistant for Cherry Studio, an AI chat desktop application.
Analyze the following error and provide a diagnosis in ${language}.

IMPORTANT:
- Respond ONLY with valid JSON, no markdown code blocks
- The JSON must match this exact structure: { "summary": "string", "category": "string", "explanation": "string", "steps": [{ "text": "string", "link?": "url", "nav?": "internal route" }] }
- "summary" is a one-line summary of what went wrong
- "category" is the error category (e.g. "authentication", "quota", "model_unavailable", "network", "content_policy", "server_error", "mcp", "knowledge_base", "ocr", "unknown")
- "explanation" is a 2-3 sentence plain language explanation of why the error occurred
- "steps" are 2-4 actionable steps to fix the issue
- Each step can optionally have "link" (external URL) or "nav" (internal app route)
- Valid "nav" values are ONLY: "/settings/provider", "/settings/model", "/settings/general", "/settings/display", "/settings/data", "/settings/mcp/servers", "/settings/websearch", "/settings/memory", "/settings/shortcut", "/settings/about", "/knowledge", "/files", "/agents", "/translate", "/notes", "/paintings", "/code", "/openclaw", "/store", "/launchpad"
- Do NOT use any nav value not in the above list
- Do NOT include API keys, personal data, or file paths in your response`

  const content = `Error details:\n${JSON.stringify(errorInfo, null, 2)}`

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

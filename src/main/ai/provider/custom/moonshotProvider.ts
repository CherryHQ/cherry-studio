import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import { type EmbeddingModelV3, type LanguageModelV3, NoSuchModelError, type ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { jsonSchema, tool } from 'ai'

export const MOONSHOT_PROVIDER_NAME = 'moonshot' as const

/**
 * Kimi's official tools are "formulas" the platform executes for you: the model emits a normal
 * function call, the client POSTs those arguments to the formula's fiber endpoint, and the fiber's
 * output goes back as the tool result (platform.kimi.com/docs/guide/use-official-tools).
 *
 * This replaces the older `$web_search` builtin-function round-trip, which is a K2-line protocol —
 * on kimi-k3 the documented echo returns 400 `tokenization failed`. The vendor's own sample runs the
 * formula channel against `kimi-k2-turbo-preview`, so one path serves both lines.
 */
export const KIMI_WEB_SEARCH_FORMULA_URI = 'moonshot/web-search:latest'
export const KIMI_WEB_SEARCH_TOOL_NAME = 'web_search'

interface FormulaFiber {
  status?: string
  error?: unknown
  context?: { output?: string; encrypted_output?: string; error?: unknown }
}

/**
 * Execute one formula fiber. Mirrors the vendor sample's result handling: a succeeded fiber carries
 * its payload as `output` or — for `protected` formulas like web-search — `encrypted_output`, and the
 * sample falls through on an EMPTY output, not just a missing one. Every failure shape is surfaced as
 * an `Error: …` string so the model can react instead of the agent loop dying on a tool failure.
 *
 * `arguments` goes out as a JSON string, matching the wire contract. The vendor passes the model's own
 * encoded string straight through; the SDK only hands `execute` the parsed input, so this re-encodes
 * it — same content, possibly different whitespace.
 */
export async function runFormulaFiber(
  settings: { baseURL: string; apiKey: string; fetch?: FetchFunction },
  formulaUri: string,
  name: string,
  args: unknown
): Promise<string> {
  const doFetch = settings.fetch ?? globalThis.fetch
  const response = await doFetch(`${withoutTrailingSlash(settings.baseURL)}/formulas/${formulaUri}/fibers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: JSON.stringify(args ?? {}) })
  })

  const fiber = (await response.json().catch(() => ({}))) as FormulaFiber
  if (fiber.status === 'succeeded') {
    const output = fiber.context?.output || fiber.context?.encrypted_output
    if (output) return output
  }
  const failure = fiber.error ?? fiber.context?.error ?? fiber.context?.output
  return `Error: ${typeof failure === 'string' ? failure : JSON.stringify(failure ?? 'unknown error')}`
}

/**
 * The declaration mirrors `GET /formulas/moonshot/web-search:latest/tools`. It is inlined because the
 * AI SDK needs the schema synchronously when the tool set is built; the fiber call is what actually
 * runs the search, so a drifted description costs nothing.
 */
export function createKimiWebSearchTool(runFiber: (args: unknown) => Promise<string>) {
  return tool({
    description: 'Search the web for information',
    inputSchema: jsonSchema<{ query: string }>({
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for' } },
      required: ['query']
    }),
    // Returning the raw string matters: the SDK maps a string result to a `text` tool output, which
    // reaches the wire verbatim. Anything else would JSON-quote the opaque (encrypted) fiber payload.
    execute: (input) => runFiber(input)
  })
}

export interface MoonshotProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
  includeUsage?: boolean
}

export interface MoonshotProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  chatModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  textEmbeddingModel(modelId: string): EmbeddingModelV3
  /**
   * Formula execution needs the same credential and base URL as chat, and the tool factory only ever
   * receives the provider instance — so the runner is exposed here rather than threaded through a
   * second credential path.
   */
  runWebSearchFiber(args: unknown): Promise<string>
}

export function createMoonshotProvider(settings: MoonshotProviderSettings = {}): MoonshotProvider {
  const { baseURL = 'https://api.moonshot.cn/v1', fetch: customFetch } = settings
  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`
  const headers = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: 'MOONSHOT_API_KEY',
      description: 'Moonshot'
    })}`,
    ...settings.headers
  })

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${MOONSHOT_PROVIDER_NAME}.chat`,
      url,
      headers,
      fetch: customFetch,
      includeUsage: settings.includeUsage
    })

  const createEmbeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${MOONSHOT_PROVIDER_NAME}.embedding`,
      url,
      headers,
      fetch: customFetch
    })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.chatModel = createChatModel
  provider.embeddingModel = createEmbeddingModel
  provider.textEmbeddingModel = createEmbeddingModel
  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' })
  }
  provider.runWebSearchFiber = (args: unknown) =>
    runFormulaFiber(
      {
        baseURL,
        apiKey: loadApiKey({
          apiKey: settings.apiKey,
          environmentVariableName: 'MOONSHOT_API_KEY',
          description: 'Moonshot'
        }),
        fetch: customFetch
      },
      KIMI_WEB_SEARCH_FORMULA_URI,
      KIMI_WEB_SEARCH_TOOL_NAME,
      args
    )

  return provider as MoonshotProvider
}

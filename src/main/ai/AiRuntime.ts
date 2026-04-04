import { loggerService } from '@logger'
import type { EmbedManyResult, GenerateImageResult, ToolLoopAgent, ToolLoopAgentSettings, ToolSet } from 'ai'

const logger = loggerService.withContext('AiRuntime')

// ============================================================================
// Types
// ============================================================================

/**
 * Provider + model resolution context.
 * Enough information to create an AI SDK LanguageModel / ImageModel / EmbeddingModel.
 */
export interface ModelRef {
  /** Provider identifier (e.g. 'openai', 'anthropic', 'ollama'). */
  providerId: string
  /** Model identifier (e.g. 'gpt-4o', 'claude-sonnet-4-20250514'). */
  modelId: string
}

/**
 * Agent configuration — extends AI SDK's ToolLoopAgentSettings
 * with Cherry-specific fields.
 *
 * The caller (AiService / AgentRuntime) is responsible for
 * assembling instructions, tools, and stop conditions.
 */
export interface AgentConfig<TOOLS extends ToolSet = ToolSet> {
  /** Which model to use. */
  model: ModelRef
  /** System instructions for the agent. */
  instructions?: string
  /** Tools the agent can call. */
  tools?: TOOLS
  /** When to stop the tool loop. Default: stepCountIs(20). */
  stopWhen?: ToolLoopAgentSettings<never, TOOLS>['stopWhen']
  /**
   * Dynamic per-step configuration — switch model, adjust tools,
   * trim context, etc. This is where context management happens.
   */
  prepareStep?: ToolLoopAgentSettings<never, TOOLS>['prepareStep']
  /** Callback after each step completes. */
  onStepFinish?: ToolLoopAgentSettings<never, TOOLS>['onStepFinish']
  /** Provider-specific options (reasoning, web search, etc.). */
  providerOptions?: Record<string, unknown>
  /** Telemetry settings. */
  telemetry?: ToolLoopAgentSettings<never, TOOLS>['experimental_telemetry']
}

/**
 * Image generation parameters.
 * Used by the paintings page and inline image generation.
 */
export interface ImageGenerationParams {
  model: ModelRef
  prompt: string
  n?: number
  size?: string
  providerOptions?: Record<string, unknown>
}

/**
 * Embedding parameters.
 */
export interface EmbedParams {
  model: ModelRef
  values: string[]
}

// ============================================================================
// AiRuntime
// ============================================================================

/**
 * Unified AI runtime — the single entry point for all AI capabilities.
 *
 * Two modes of operation:
 *
 * 1. **Agent mode** (conversational): `createAgent()` → `ToolLoopAgent`
 *    - Chat, Agent sessions, translation, summarization, OCR
 *    - Multi-step tool loop with context management
 *    - Single-shot: set `stopWhen: stepCountIs(1)`
 *
 * 2. **Direct mode** (non-conversational): `generateImage()`, `embed()`
 *    - Paintings page, embedding indexing, TTS/STT
 *    - No tool loop, no context, just execute and return
 *
 * AiRuntime does NOT manage:
 * - IPC transport (that's AiService)
 * - Parameter assembly / business logic (that's the caller)
 * - Message persistence (that's DataApi)
 *
 * AiRuntime delegates to `@cherrystudio/ai-core` for:
 * - Provider registry and model resolution
 * - Plugin pipeline (middleware, reasoning extraction, etc.)
 *
 * TODO: aiCore needs to export `createAgent()` that applies
 * the plugin pipeline to ToolLoopAgent. Currently aiCore only
 * has `createExecutor()` for direct streamText/generateText calls.
 */
export class AiRuntime {
  // ---- Agent mode ----

  /**
   * Create a configured ToolLoopAgent.
   *
   * The returned agent is ready to call `.stream()` or `.generate()`.
   * The caller (AiService) manages the agent's lifecycle.
   *
   * @example
   * ```ts
   * // Chat — manual mode (user controls each message)
   * const agent = runtime.createAgent({
   *   model: { providerId: 'openai', modelId: 'gpt-4o' },
   *   instructions: assistant.prompt,
   *   tools: { webSearch, knowledge },
   * })
   * const result = await agent.stream({ messages })
   *
   * // Single-shot — OCR, translation, etc.
   * const agent = runtime.createAgent({
   *   model: { providerId: 'openai', modelId: 'gpt-4o' },
   *   stopWhen: stepCountIs(1),
   * })
   * const result = await agent.generate({ messages: [{ role: 'user', content: 'Translate: ...' }] })
   * ```
   */
  createAgent<TOOLS extends ToolSet>(config: AgentConfig<TOOLS>): ToolLoopAgent<never, TOOLS> {
    logger.info('Creating agent', { providerId: config.model.providerId, modelId: config.model.modelId })

    // TODO: Replace with aiCore's createAgent() once implemented.
    // aiCore should handle:
    // 1. Resolve providerId + modelId → LanguageModel (via extensionRegistry)
    // 2. Apply plugin pipeline (middleware, reasoning, cache, etc.)
    // 3. Construct ToolLoopAgent with the resolved model
    //
    // For now, placeholder:
    throw new Error('createAgent not yet implemented — waiting for aiCore.createAgent()')
  }

  // ---- Direct mode ----

  /**
   * Generate images directly (paintings page, inline image generation).
   * Does NOT go through ToolLoopAgent.
   */
  async generateImage(params: ImageGenerationParams): Promise<GenerateImageResult> {
    logger.info('Generating image', { providerId: params.model.providerId, modelId: params.model.modelId })

    // TODO: Use aiCore's generateImage() with provider resolution
    throw new Error('generateImage not yet implemented')
  }

  /**
   * Generate embeddings directly (knowledge base indexing, similarity search).
   * Does NOT go through ToolLoopAgent.
   */
  async embed(params: EmbedParams): Promise<EmbedManyResult> {
    logger.info('Embedding', { providerId: params.model.providerId, count: params.values.length })

    // TODO: Use aiCore's embedMany() with provider resolution
    throw new Error('embed not yet implemented')
  }

  // ---- Future capabilities ----

  // TODO: generateSpeech(params): Promise<SpeechResult>
  // TODO: transcribe(params): Promise<TranscriptionResult>
  // TODO: generateVideo(params): Promise<VideoResult>

  // ---- Internal ----

  // TODO: Implement when aiCore exposes model resolution API
  // resolveLanguageModel(ref: ModelRef): LanguageModel
  // resolveImageModel(ref: ModelRef): ImageModel
  // resolveEmbeddingModel(ref: ModelRef): EmbeddingModel
}

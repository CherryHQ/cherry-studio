import type { ModelMessage, TextStreamPart, ToolSet } from 'ai'

/** Identifies one model call, so the host can attribute side-channel data to the turn that produced it. */
export interface ModelCallInfo {
  /** Unique per model call. Calls of one session run one after another. */
  requestId: string
  /** Pi session id; summarization calls may carry a one-off id. */
  sessionId: string | undefined
  /** The Pi model the call is for. */
  model: { provider: string; id: string }
}

/** One single-step model request, built from Pi's transcript. */
export interface ModelCallRequest<TRequestOptions = undefined> extends ModelCallInfo {
  system: string | undefined
  messages: ModelMessage[]
  /** Pi's tools without `execute`: the AI SDK returns tool calls and Pi runs them. */
  tools: ToolSet
  toolChoice: 'auto' | 'none' | undefined
  maxOutputTokens: number | undefined
  temperature: number | undefined
  abortSignal: AbortSignal | undefined
  /** Host-chosen options (e.g. reasoning effort), forwarded verbatim; never derived from Pi's thinking level. */
  options: TRequestOptions
}

/** The part of an AI SDK `streamText` result the bridge reads. */
export interface ModelCallResult {
  fullStream: ReadableStream<TextStreamPart<ToolSet>>
}

/**
 * Host-implemented model call. Implement it with AI SDK `streamText` (in Cherry, through ai-core's
 * executor so the plugin chain, retries and usage accounting apply). Pi owns the agent loop, so the
 * call must be single-step; with no `execute` on the tools the AI SDK stops after one step anyway.
 * Errors may be thrown or emitted as `error` stream parts.
 */
export interface ModelCallPort<TRequestOptions = undefined> {
  streamText(request: ModelCallRequest<TRequestOptions>): ModelCallResult | Promise<ModelCallResult>
}

/** Stream parts a Pi assistant message cannot hold. Provider-executed tool calls never reach Pi's executor. */
export type UnmappedStreamPart = Extract<
  TextStreamPart<ToolSet>,
  { type: 'source' | 'file' | 'tool-call' | 'tool-result' | 'tool-error' }
>

/** Host callbacks for what Pi messages cannot carry. Callbacks run inline with the stream and must not throw. */
export interface ModelCallSideChannel {
  onUnmappedPart?(part: UnmappedStreamPart, call: ModelCallInfo): void
  /** The original error object (e.g. `APICallError` with `statusCode`/`responseBody`); Pi keeps only its message. Not called on abort. */
  onError?(error: unknown, call: ModelCallInfo): void
}

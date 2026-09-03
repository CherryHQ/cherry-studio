import type { ProxyRoutingSnapshot } from '@main/services/proxy/proxyRouting'

/**
 * Process-agnostic messages exchanged by an inference host and its capability worker.
 * Keep these values structured-clone-safe so the host can move from worker_threads to
 * utilityProcess without changing capability APIs.
 */

export type LocalInferenceProfileId = 'cpu' | 'directml' | 'coreml'
export type LocalInferenceDevice = 'cpu' | 'dml' | 'coreml'
export type LocalInferenceExecutionProvider = 'cpu' | 'dml' | 'coreml' | { name: 'coreml'; coreMlFlags: number }

export interface LocalInferenceSessionOptions {
  executionProviders: LocalInferenceExecutionProvider[]
  enableMemPattern?: boolean
  executionMode?: 'sequential'
}

export interface LocalInferenceRuntimeProfile {
  id: LocalInferenceProfileId
  transformersDevice: LocalInferenceDevice
  sessionOptions: LocalInferenceSessionOptions
  embeddingSessionOptions?: LocalInferenceSessionOptions
}

export interface InferenceInitMessage<TCapability extends string = string> {
  kind: 'init'
  capability: TCapability
  appPath: string
  /** Absolute entry paths keyed by catalog artifact id. */
  artifactPaths: Record<string, string>
  runtimeProfile: LocalInferenceRuntimeProfile
  proxyRouting: ProxyRoutingSnapshot
}

export interface InferenceRequestMessage<
  TCapability extends string = string,
  TType extends string = string,
  TPayload = unknown
> {
  kind: 'request'
  capability: TCapability
  type: TType
  requestId: string
  payload: TPayload
}

export interface InferenceLogMessage {
  kind: 'log'
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface InferenceResultMessage<TPayload = unknown> {
  kind: 'result'
  requestId: string
  payload: TPayload
}

export interface InferenceErrorMessage {
  kind: 'error'
  requestId: string
  message: string
}

export type InferenceResponse<TPayload = unknown> =
  | InferenceLogMessage
  | InferenceResultMessage<TPayload>
  | InferenceErrorMessage

export type InferenceResultKeyMap<TRequests, TResults extends { [TType in keyof TRequests]: object }> = {
  [TType in Extract<keyof TRequests, string>]: readonly Extract<keyof TResults[TType], string>[]
}

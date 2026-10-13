/**
 * Structured-clone-safe data shared by the main process and inference utility processes.
 * Inference is offline, so nothing here may carry a credential or a network policy.
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

export interface InferenceInitData {
  appPath: string
  /** Absolute entry paths keyed by catalog artifact id. */
  artifactPaths: Record<string, string>
  runtimeProfile: LocalInferenceRuntimeProfile
}

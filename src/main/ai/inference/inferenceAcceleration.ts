import type { LocalInferenceRuntimeProfile } from './inferenceProtocol'

export interface LocalInferenceTarget {
  platform: NodeJS.Platform
  arch: string
}

export const CPU_LOCAL_INFERENCE_PROFILE: LocalInferenceRuntimeProfile = {
  id: 'cpu',
  transformersDevice: 'cpu',
  sessionOptions: { executionProviders: ['cpu'] }
}

const DIRECTML_PROFILE: LocalInferenceRuntimeProfile = {
  id: 'directml',
  transformersDevice: 'dml',
  sessionOptions: {
    executionProviders: ['dml', 'cpu'],
    enableMemPattern: false,
    executionMode: 'sequential'
  }
}

const COREML_PROFILE: LocalInferenceRuntimeProfile = {
  id: 'coreml',
  transformersDevice: 'coreml',
  sessionOptions: { executionProviders: ['coreml', 'cpu'] },
  embeddingSessionOptions: {
    executionProviders: [{ name: 'coreml', coreMlFlags: 8 }, 'cpu']
  }
}

const HARDWARE_PROFILES: Partial<Record<NodeJS.Platform, Record<string, LocalInferenceRuntimeProfile>>> = {
  win32: { x64: DIRECTML_PROFILE, arm64: DIRECTML_PROFILE },
  darwin: { arm64: COREML_PROFILE }
}

const currentTarget = (): LocalInferenceTarget => ({ platform: process.platform, arch: process.arch })

export function isLocalInferenceHardwareAccelerationSupported(target = currentTarget()): boolean {
  return HARDWARE_PROFILES[target.platform]?.[target.arch] !== undefined
}

export function resolveLocalInferenceProfile(
  hardwareAccelerationEnabled: boolean,
  target = currentTarget()
): LocalInferenceRuntimeProfile {
  return hardwareAccelerationEnabled
    ? (HARDWARE_PROFILES[target.platform]?.[target.arch] ?? CPU_LOCAL_INFERENCE_PROFILE)
    : CPU_LOCAL_INFERENCE_PROFILE
}

import { shell, systemPreferences } from 'electron'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  FUNASR_SUPPORTED_PLATFORM_KEYS,
  WINDOWS_TTS_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  type LocalSpeechModelId,
  type LocalTranscriptionModelId
} from '@shared/ai/localVoice'

import { VoiceRuntimeError } from './VoiceRuntimeError'

export interface VoiceEnvironment {
  platform: string
  arch?: string
  majorVersion?: number
  minorVersion?: number
}

export function getVoiceEnvironment(): VoiceEnvironment {
  return {
    platform: process.platform,
    arch: process.arch,
    majorVersion: process.platform === 'darwin' ? Number.parseInt(process.getSystemVersion?.() ?? '', 10) : undefined,
    minorVersion: process.platform === 'darwin' ? Number(process.getSystemVersion?.().split('.')[1] ?? 0) : undefined
  }
}

export function getMicrophoneStatus(): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown'
  try {
    return systemPreferences.getMediaAccessStatus('microphone')
  } catch {
    return 'unknown'
  }
}

export async function openMicrophoneSettings(): Promise<void> {
  const urls: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    win32: 'ms-settings:privacy-microphone'
  }
  const url = urls[process.platform]
  if (!url) throw new VoiceRuntimeError('unsupported')
  await shell.openExternal(url)
}

/** A recommendation only: unavailable resources never change an explicit selection. */
export function resolveDefaultAsrModel(
  platform: { platform: string; arch?: string; majorVersion?: number },
  explicitModelId?: LocalTranscriptionModelId
): LocalTranscriptionModelId | undefined {
  if (explicitModelId !== undefined) return explicitModelId
  if (platform.platform === 'darwin') {
    if (platform.majorVersion !== undefined && Number.isInteger(platform.majorVersion) && platform.majorVersion >= 13)
      return APPLE_ASR_MODEL_ID
  }
  if (platform.platform === 'win32' && platform.arch === 'x64') return WINDOWS_ASR_MODEL_ID
  const platformKey = `${platform.platform}-${platform.arch}`
  return FUNASR_SUPPORTED_PLATFORM_KEYS.some((supported) => supported === platformKey) ? FUNASR_MODEL_ID : undefined
}

export function resolveDefaultSpeechModel(platform: {
  platform: string
  arch?: string
  majorVersion?: number
  minorVersion?: number
}): LocalSpeechModelId | undefined {
  if (platform.platform === 'win32' && platform.arch === 'x64') return WINDOWS_TTS_MODEL_ID
  if (
    platform.platform === 'darwin' &&
    platform.majorVersion !== undefined &&
    Number.isInteger(platform.majorVersion) &&
    platform.majorVersion >= 13
  )
    return APPLE_TTS_MODEL_ID
  return undefined
}

export async function openSystemVoiceSettings(): Promise<void> {
  const urls: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'x-apple.systempreferences:com.apple.preference.universalaccess',
    win32: 'ms-settings:speech'
  }
  const url = urls[process.platform]
  if (!url) throw new VoiceRuntimeError('unsupported')
  await shell.openExternal(url)
}

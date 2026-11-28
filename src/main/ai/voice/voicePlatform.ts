import os from 'node:os'

import { shell, systemPreferences } from 'electron'

import { isWindowsLegacy, parseOsMajorVersion } from '@main/core/platform'
import {
  VoiceModelSupport,
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  FUNASR_SUPPORTED_PLATFORM_KEYS,
  KOKORO_TTS_MODEL_ID,
  SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS,
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
  if (process.platform === 'darwin') {
    return {
      platform: process.platform,
      arch: process.arch,
      majorVersion: Number.parseInt(process.getSystemVersion?.() ?? '', 10),
      minorVersion: Number(process.getSystemVersion?.().split('.')[1] ?? 0)
    }
  }
  if (process.platform === 'win32') {
    const version = process.getSystemVersion?.() || os.release()
    return {
      platform: process.platform,
      arch: process.arch,
      majorVersion: parseOsMajorVersion(version),
      minorVersion: Number(version.split('.')[1] ?? 0)
    }
  }
  return {
    platform: process.platform,
    arch: process.arch
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
  if (isWindowsLegacy()) throw new VoiceRuntimeError('unsupported')
  const urls: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    win32: 'ms-settings:privacy-microphone'
  }
  const url = urls[process.platform]
  if (!url) throw new VoiceRuntimeError('unsupported')
  await shell.openExternal(url)
}

function isLegacyWindowsPlatform(platform: { platform: string; majorVersion?: number }): boolean {
  return (
    platform.platform === 'win32' &&
    platform.majorVersion !== undefined &&
    (!Number.isInteger(platform.majorVersion) || platform.majorVersion < 10)
  )
}

function isSupportedWindowsX64(platform: { platform: string; arch?: string; majorVersion?: number }): boolean {
  return platform.platform === 'win32' && platform.arch === 'x64' && !isLegacyWindowsPlatform(platform)
}

/** A recommendation only: unavailable resources never change an explicit selection. */
export function resolveDefaultAsrModel(
  platform: { platform: string; arch?: string; majorVersion?: number },
  explicitModelId?: LocalTranscriptionModelId
): LocalTranscriptionModelId | undefined {
  if (explicitModelId !== undefined) return explicitModelId
  if (isLegacyWindowsPlatform(platform)) return undefined
  if (platform.platform === 'darwin') {
    if (platform.majorVersion !== undefined && Number.isInteger(platform.majorVersion) && platform.majorVersion >= 13)
      return APPLE_ASR_MODEL_ID
  }
  if (isSupportedWindowsX64(platform)) return WINDOWS_ASR_MODEL_ID
  const platformKey = `${platform.platform}-${platform.arch}`
  return FUNASR_SUPPORTED_PLATFORM_KEYS.some((supported) => supported === platformKey) ? FUNASR_MODEL_ID : undefined
}

export function resolveDefaultSpeechModel(platform: {
  platform: string
  arch?: string
  majorVersion?: number
  minorVersion?: number
}): LocalSpeechModelId | undefined {
  if (isLegacyWindowsPlatform(platform)) return undefined
  if (isSupportedWindowsX64(platform)) return WINDOWS_TTS_MODEL_ID
  if (
    platform.platform === 'darwin' &&
    platform.majorVersion !== undefined &&
    Number.isInteger(platform.majorVersion) &&
    platform.majorVersion >= 13
  )
    return APPLE_TTS_MODEL_ID
  if (SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS.some((key) => key === `${platform.platform}-${platform.arch}`))
    return KOKORO_TTS_MODEL_ID
  return undefined
}

export async function openSystemVoiceSettings(): Promise<void> {
  if (isWindowsLegacy()) throw new VoiceRuntimeError('unsupported')
  const urls: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'x-apple.systempreferences:com.apple.preference.universalaccess',
    win32: 'ms-settings:speech'
  }
  const url = urls[process.platform]
  if (!url) throw new VoiceRuntimeError('unsupported')
  await shell.openExternal(url)
}

export function mlxVoiceSupport(environment: VoiceEnvironment) {
  if (environment.platform !== 'darwin') return VoiceModelSupport.UnsupportedPlatform
  if (environment.arch !== 'arm64') return VoiceModelSupport.UnsupportedArchitecture
  const major = environment.majorVersion ?? 0
  const minor = environment.minorVersion ?? 0
  if (!Number.isInteger(major) || major < 26 || (major === 26 && (!Number.isInteger(minor) || minor < 2)))
    return VoiceModelSupport.UnsupportedVersion
  return VoiceModelSupport.Supported
}

import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { fileRequestSchemas } from '../../../src/shared/ipc/schemas/file'
import { voiceRequestSchemas } from '../../../src/shared/ipc/schemas/voice'
import { selectMainTarget, validateConnection } from '../connection'
import { createVoiceRuntimeSmokeExpression } from '../rendererExpression'

const expectedUrl = 'http://localhost:5173/index.html'

describe('voice smoke connection boundary', () => {
  it('refuses remote CDP servers and remote renderer content', () => {
    expect(() => validateConnection('http://example.com:9222', expectedUrl)).toThrow()
    expect(() => validateConnection('http://127.0.0.1:9222', 'https://example.com')).toThrow()
    expect(() => validateConnection('http://127.0.0.1:9222', 'file://remote-server/shared/index.html')).toThrow()
  })

  it('requires one exact main page, with a debugger on the supplied endpoint', () => {
    const endpoint = 'http://127.0.0.1:9222'
    const target = { type: 'page', url: expectedUrl, webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/one' }
    expect(selectMainTarget([target], endpoint, expectedUrl)).toBe(target.webSocketDebuggerUrl)
    expect(() => selectMainTarget([{ ...target, url: `${expectedUrl}#other` }], endpoint, expectedUrl)).toThrow()
    expect(() => selectMainTarget([target, target], endpoint, expectedUrl)).toThrow()
    expect(() =>
      selectMainTarget([{ ...target, webSocketDebuggerUrl: 'ws://example.com/one' }], endpoint, expectedUrl)
    ).toThrow()
  })
})

function browserEnvironment(transcription: 'success' | 'empty' | 'funasr_fallback' | 'native_failure') {
  const created = new Set<string>()
  const discarded = new Set<string>()
  const requestedModels: string[] = []
  const languageRequests: { route: string; language: string; voice?: string; text?: string }[] = []
  const voices = [
    { id: 'com.apple.voice.test.en-US', name: 'Synthetic English voice', language: 'en-US' },
    { id: 'com.apple.voice.test.zh-CN', name: 'Synthetic Chinese voice', language: 'zh-CN' }
  ]
  const audio = { duration: 0.001, sampleRate: 48000, numberOfChannels: 1 }
  let ended: (() => void) | null = null
  let recorderStopped = false
  let contextClosed = false
  let tracksStopped = false
  class AudioContext {
    state = 'running'
    destination = {}
    async resume() {}
    async close() {
      contextClosed = true
    }
    async decodeAudioData() {
      return audio
    }
    createMediaStreamDestination() {
      return {
        channelCount: 1,
        stream: {
          getTracks: () => [
            {
              stop: () => {
                tracksStopped = true
              }
            }
          ]
        }
      }
    }
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        disconnect() {},
        start() {
          queueMicrotask(() => ended?.())
        },
        stop() {},
        set onended(value: (() => void) | null) {
          ended = value
        }
      }
    }
  }
  class MediaRecorder {
    static isTypeSupported() {
      return true
    }
    state = 'inactive'
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      recorderStopped = true
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])]) })
      this.onstop?.()
    }
  }
  const handle = async (route: string, input?: Record<string, any>) => {
    const schemas = { ...voiceRequestSchemas, 'file.read': fileRequestSchemas['file.read'] }
    schemas[route as keyof typeof schemas].input.parse(input)
    if (input?.language)
      languageRequests.push({ route, language: input.language, voice: input.voice, text: input.text })
    if (route === 'ai.speech.voices.list') return voices
    if (route === 'ai.voice.model.status') return { status: 'ready' }
    if (route === 'ai.speech.generate') {
      created.add(input!.sessionId)
      if (input!.voice !== voices.find((voice) => voice.language === input!.language)?.id)
        throw new Error('Exact selected voice was not used')
      return { fileEntry: { id: 'e0b0c5ec-dcb8-4f77-b027-0a3c05637786' }, mimeType: 'audio/wav' }
    }
    if (route === 'file.read') return { content: new Uint8Array([82, 73, 70, 70]), mime: 'audio/wav' }
    if (route === 'file.voice_recording.create') {
      created.add(input!.sessionId)
      return { id: randomUUID() }
    }
    if (route === 'ai.transcription.generate') {
      requestedModels.push(input!.modelId)
      if (transcription === 'native_failure')
        throw { code: 'SENSITIVE_NATIVE_DETAIL', message: '/private/audio transcript' }
      if (input!.modelId === 'local-voice::funasr-nano' && transcription !== 'funasr_fallback') {
        throw { code: 'VOICE_LICENSE_UNVERIFIED' }
      }
      return {
        text: transcription === 'empty' ? '' : 'Private transcript must not appear in evidence',
        language: 'en',
        durationInSeconds: 0.001
      }
    }
    if (route === 'ai.voice.session.discard') {
      discarded.add(input!.sessionId)
      return
    }
    throw new Error('Unexpected route')
  }
  const request = async (route: string, input?: Record<string, any>) => {
    try {
      return { ok: true, data: await handle(route, input) }
    } catch (error) {
      return { ok: false, error }
    }
  }
  return {
    globals: {
      window: { api: { ipcApi: { request } } },
      location: { href: expectedUrl },
      crypto: { randomUUID },
      AudioContext,
      MediaRecorder,
      Uint8Array,
      Blob,
      Promise,
      setTimeout,
      clearTimeout
    },
    created,
    discarded,
    requestedModels,
    languageRequests,
    resourcesClosed: () => recorderStopped && contextClosed && tracksStopped
  }
}

describe('voice smoke renderer contract', () => {
  it('refuses to run after the target navigates', async () => {
    const fixture = browserEnvironment('success')
    fixture.globals.location.href = `${expectedUrl}#wrong`
    const result = await runInNewContext(createVoiceRuntimeSmokeExpression(expectedUrl), fixture.globals)
    expect(result).toMatchObject({ passed: false, stage: 'target', code: 'TARGET_MISMATCH' })
    expect(fixture.created.size).toBe(0)
  })

  it('requires nonempty Apple output and explicit FunASR rejection, discarding every session without leaking content', async () => {
    const fixture = browserEnvironment('success')
    const result = await runInNewContext(createVoiceRuntimeSmokeExpression(expectedUrl), fixture.globals)
    expect(result).toMatchObject({
      passed: true,
      apple: { transcriptNonEmpty: true },
      funasr: { reason: 'license_unverified' },
      cleanupSucceeded: true
    })
    expect(fixture.requestedModels).toEqual(['local-voice::apple-system-asr', 'local-voice::funasr-nano'])
    expect(fixture.created.size).toBe(3)
    expect(fixture.discarded).toEqual(fixture.created)
    expect(fixture.resourcesClosed()).toBe(true)
    expect(JSON.stringify(result)).not.toContain('Private transcript')
    expect(JSON.stringify(result)).not.toContain('e0b0c5ec-dcb8-4f77-b027-0a3c05637786')
  })

  it('uses the selected installed Chinese voice and locale throughout the real IPC schemas', async () => {
    const fixture = browserEnvironment('success')
    const result = await runInNewContext(createVoiceRuntimeSmokeExpression(expectedUrl, 'zh-CN'), fixture.globals)
    expect(result).toMatchObject({
      passed: true,
      selectedVoice: { id: 'com.apple.voice.test.zh-CN', language: 'zh-CN' }
    })
    expect(fixture.languageRequests.map(({ language }) => language)).toEqual(['zh-CN', 'zh-CN', 'zh-CN', 'zh-CN'])
    expect(fixture.languageRequests.find(({ route }) => route === 'ai.speech.generate')).toMatchObject({
      voice: 'com.apple.voice.test.zh-CN',
      text: '这是樱桃工作室的本地语音验证。今天天空晴朗，我们正在检查离线语音转写功能。'
    })
    expect(fixture.discarded).toEqual(fixture.created)
  })

  it('rejects unapproved test languages before any IPC session is created', async () => {
    const fixture = browserEnvironment('success')
    const result = await runInNewContext(
      createVoiceRuntimeSmokeExpression(expectedUrl, 'fr-FR' as never),
      fixture.globals
    )
    expect(result).toMatchObject({ passed: false, code: 'INVALID_LANGUAGE' })
    expect(fixture.created.size).toBe(0)
    expect(fixture.languageRequests).toEqual([])
  })

  it.each(['empty', 'funasr_fallback', 'native_failure'] as const)('fails closed and cleans up on %s', async (mode) => {
    const fixture = browserEnvironment(mode)
    const result = await runInNewContext(createVoiceRuntimeSmokeExpression(expectedUrl), fixture.globals)
    expect(result.passed).toBe(false)
    expect(result.cleanupSucceeded).toBe(true)
    expect(fixture.discarded).toEqual(fixture.created)
    expect(fixture.resourcesClosed()).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/private|transcript must|SENSITIVE_NATIVE_DETAIL/)
  })
})

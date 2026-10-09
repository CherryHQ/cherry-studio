import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

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

function browserEnvironment(
  transcription: 'success' | 'empty' | 'funasr_fallback' | 'native_failure',
  windows = false
) {
  const created = new Set<string>()
  const discarded = new Set<string>()
  const preempted = new Set<string>()
  let lease: { sessionId: string; phase: 'ready' | 'recording' | 'recorded'; fileEntryId?: string } | undefined
  const requestedModels: string[] = []
  const languageRequests: { route: string; language: string; voice?: string; text?: string }[] = []
  const voicePrefix = windows ? 'windows-sapi-test' : 'com.apple.voice.test'
  const voices = [
    { id: `${voicePrefix}.en-US`, name: 'Synthetic English voice', language: 'en-US' },
    { id: `${voicePrefix}.zh-CN`, name: 'Synthetic Chinese voice', language: 'zh-CN' }
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
    voiceRequestSchemas[route as keyof typeof voiceRequestSchemas].input.parse(input)
    if (input?.language)
      languageRequests.push({ route, language: input.language, voice: input.voice, text: input.text })
    if (route === 'ai.speech.voices.list') return voices
    if (route === 'ai.voice.model.status') return { status: 'ready' }
    if (route === 'ai.speech.generate') {
      if (lease) throw { code: 'VOICE_BUSY' }
      created.add(input!.sessionId)
      if (input!.voice !== voices.find((voice) => voice.language === input!.language)?.id)
        throw new Error('Exact selected voice was not used')
      lease = {
        sessionId: input!.sessionId,
        phase: 'ready',
        fileEntryId: 'e0b0c5ec-dcb8-4f77-b027-0a3c05637786'
      }
      return { fileEntry: { id: lease.fileEntryId }, mimeType: 'audio/wav' }
    }
    if (route === 'ai.voice.output.read') {
      if (!lease || lease.sessionId !== input!.sessionId) throw { code: 'VOICE_INVALID_REQUEST' }
      if (lease.phase !== 'ready' || lease.fileEntryId !== input!.fileEntryId) throw { code: 'VOICE_FORBIDDEN' }
      return { audio: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav' }
    }
    if (route === 'ai.voice.recording.start') {
      if (lease) preempted.add(lease.sessionId)
      created.add(input!.sessionId)
      lease = { sessionId: input!.sessionId, phase: 'recording' }
      return { sessionId: lease.sessionId, phase: lease.phase, revision: 1 }
    }
    if (route === 'file.voice_recording.create') {
      if (lease?.sessionId !== input!.sessionId || lease?.phase !== 'recording') throw { code: 'VOICE_INVALID_REQUEST' }
      lease.phase = 'recorded'
      lease.fileEntryId = randomUUID()
      return { id: lease.fileEntryId }
    }
    if (route === 'ai.transcription.generate') {
      if (lease?.sessionId !== input!.sessionId || lease?.phase !== 'recorded') throw { code: 'VOICE_INVALID_REQUEST' }
      if (lease.fileEntryId !== input!.fileEntryId) throw { code: 'VOICE_FORBIDDEN' }
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
      if (lease?.sessionId === input!.sessionId) lease = undefined
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
    preempted,
    requestedModels,
    languageRequests,
    activeSessionId: () => lease?.sessionId,
    resourcesClosed: () => recorderStopped && contextClosed && tracksStopped && !lease
  }
}

describe('voice smoke renderer contract', () => {
  it('verifies Windows TTS without requiring ASR or microphone recording, then releases the output session', async () => {
    const fixture = browserEnvironment('native_failure', true)
    const ipc = fixture.globals.window.api.ipcApi
    const originalRequest = ipc.request
    const requestedSpeech: Record<string, any>[] = []
    ipc.request = async (route, input) => {
      if (route === 'ai.voice.model.status' && input?.modelId !== 'local-voice::windows-system-tts')
        return { ok: false, error: { code: 'VOICE_UNSUPPORTED' } }
      if (route === 'ai.speech.generate') requestedSpeech.push(input!)
      return originalRequest(route, input)
    }
    const result = await runInNewContext(createVoiceRuntimeSmokeExpression(expectedUrl, 'en-US', 'windows-tts'), {
      ...fixture.globals,
      MediaRecorder: undefined
    })
    expect(result).toMatchObject({ passed: true, mode: 'windows-tts', sessionsDiscarded: 1, cleanupSucceeded: true })
    expect(requestedSpeech).toEqual([
      expect.objectContaining({
        modelId: 'local-voice::windows-system-tts',
        voice: 'windows-sapi-test.en-US',
        speed: 1
      })
    ])
    expect(result.tts.durationSeconds).toBeGreaterThan(0)
    expect(fixture.requestedModels).toEqual([])
    expect(fixture.discarded).toEqual(fixture.created)
    expect(JSON.stringify(result)).not.toMatch(/Cherry Studio local voice verification|e0b0c5ec/)
  })

  it('does not fall back to Apple when Windows TTS is unavailable', async () => {
    const fixture = browserEnvironment('success')
    const ipc = fixture.globals.window.api.ipcApi
    const originalRequest = ipc.request
    ipc.request = async (route, input) =>
      route === 'ai.voice.model.status' ? { ok: true, data: { status: 'unsupported' } } : originalRequest(route, input)
    const result = await runInNewContext(
      createVoiceRuntimeSmokeExpression(expectedUrl, 'en-US', 'windows-tts'),
      fixture.globals
    )
    expect(result).toMatchObject({ passed: false, stage: 'tts_status', code: 'TTS_NOT_READY' })
    expect(fixture.created.size).toBe(0)
  })

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
      cleanupSucceeded: true,
      sessionsDiscarded: 3
    })
    expect(fixture.requestedModels).toEqual(['local-voice::apple-system-asr', 'local-voice::funasr-nano'])
    expect(fixture.created.size).toBe(3)
    expect(fixture.discarded).toEqual(fixture.created)
    expect(fixture.preempted.size).toBe(0)
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

  it('reads owned speech output even when generic file access is unavailable', async () => {
    const fixture = browserEnvironment('success')
    const ipc = fixture.globals.window.api.ipcApi
    const originalRequest = ipc.request
    ipc.request = async (route, input) =>
      route === 'file.read' ? { ok: false, error: { code: 'VOICE_FORBIDDEN' } } : originalRequest(route, input)

    const result = await runInNewContext(createVoiceRuntimeSmokeExpression(expectedUrl), fixture.globals)

    expect(result).toMatchObject({ passed: true, sessionsDiscarded: 3, cleanupSucceeded: true })
    expect(fixture.resourcesClosed()).toBe(true)
  })

  it('fails an upload after another recording takes ownership without discarding the replacement', async () => {
    const fixture = browserEnvironment('success')
    const ipc = fixture.globals.window.api.ipcApi
    const originalRequest = ipc.request
    const replacementSession = randomUUID()
    ipc.request = async (route, input) => {
      if (route === 'file.voice_recording.create') {
        await originalRequest('ai.voice.recording.start', {
          sessionId: replacementSession,
          requestId: randomUUID(),
          source: 'automation'
        })
      }
      return originalRequest(route, input)
    }

    const result = await runInNewContext(createVoiceRuntimeSmokeExpression(expectedUrl), fixture.globals)

    expect(result).toMatchObject({
      passed: false,
      stage: 'apple_upload',
      code: 'VOICE_INVALID_REQUEST',
      cleanupSucceeded: true
    })
    expect(fixture.activeSessionId()).toBe(replacementSession)
    expect(fixture.discarded.has(replacementSession)).toBe(false)
    expect(result.apple).toBeUndefined()
    expect(result.funasr).toBeUndefined()
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

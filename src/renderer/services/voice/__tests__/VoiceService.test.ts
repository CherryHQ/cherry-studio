import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'

import { VoiceDomainError, VoiceService } from '../VoiceService'

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004'
]

const request = vi.fn()
const on = vi.fn()
let voiceEvent: ((event: any) => void) | undefined
let unsubscribe: ReturnType<typeof vi.fn>
let nextId = 0
let ownerWindow: Window

function createService(): VoiceService {
  return new VoiceService({
    ipc: { request, on },
    ownerWindow,
    createId: () => ids[nextId++]
  })
}

beforeEach(() => {
  request.mockReset()
  on.mockReset()
  unsubscribe = vi.fn()
  voiceEvent = undefined
  nextId = 0
  ownerWindow = Object.assign(new EventTarget(), { closed: false }) as Window
  on.mockImplementation((_event: string, listener: (event: any) => void) => {
    voiceEvent = listener
    return unsubscribe
  })
})

describe('VoiceService state ownership', () => {
  it('subscribes before reading state and ignores a stale initial snapshot', async () => {
    let resolveState!: (state: unknown) => void
    request.mockReturnValueOnce(new Promise((resolve) => (resolveState = resolve)))
    const service = createService()
    const revisions: number[] = []
    service.subscribe(() => revisions.push(service.getSnapshot().revision))

    const initializing = service.initialize()
    expect(on).toHaveBeenCalledWith('ai.voice.session_event', expect.any(Function))

    voiceEvent?.({
      type: 'state',
      revision: 4,
      phase: 'playing',
      sessionId: ids[0],
      source: 'playback',
      trigger: 'manual'
    })
    resolveState({ revision: 3, phase: 'idle' })
    await initializing

    expect(service.getSnapshot()).toMatchObject({ revision: 4, phase: 'playing', sessionId: ids[0] })
    expect(revisions).toEqual([4])
  })

  it('delivers commands only for the current owned session at a current revision', async () => {
    request.mockImplementation(async (route: string, input: any) => {
      if (route === 'ai.voice.session.state') return { revision: 1, phase: 'idle' }
      if (route === 'ai.voice.recording.start') {
        return { revision: 2, phase: 'recording', sessionId: input.sessionId, source: input.source }
      }
      return undefined
    })
    const service = createService()
    const commands: string[] = []
    service.subscribeCommands((event) => commands.push(event.command))
    await service.initialize()
    const recording = service.startRecording({ source: 'dictation' })
    await recording.result

    voiceEvent?.({ type: 'command', revision: 2, sessionId: ids[2], command: 'stop' })
    voiceEvent?.({ type: 'command', revision: 1, sessionId: recording.sessionId, command: 'pause' })
    voiceEvent?.({ type: 'command', revision: 2, sessionId: recording.sessionId, command: 'stop' })

    expect(commands).toEqual(['stop'])
  })

  it('keeps A command ownership while B admission is pending, then transfers it on B authoritative state', async () => {
    let startCount = 0
    let resolveSecond!: (state: unknown) => void
    request.mockImplementation((route: string, input: any) => {
      if (route === 'ai.voice.session.state') return Promise.resolve({ revision: 1, phase: 'idle' })
      if (route === 'ai.voice.recording.start' && ++startCount === 1) {
        return Promise.resolve({ revision: 2, phase: 'recording', sessionId: input.sessionId })
      }
      if (route === 'ai.voice.recording.start') return new Promise((resolve) => (resolveSecond = resolve))
      return Promise.resolve(undefined)
    })
    const service = createService()
    const commands: Array<{ sessionId: string; command: string }> = []
    service.subscribeCommands(({ sessionId, command }) => commands.push({ sessionId, command }))
    await service.initialize()
    const first = service.startRecording({ source: 'dictation' })
    await first.result
    const second = service.startRecording({ source: 'dictation' })
    await Promise.resolve()

    voiceEvent?.({ type: 'command', revision: 2, sessionId: first.sessionId, command: 'stop' })
    voiceEvent?.({ type: 'state', revision: 3, phase: 'recording', sessionId: second.sessionId })
    voiceEvent?.({ type: 'command', revision: 3, sessionId: second.sessionId, command: 'stop' })
    resolveSecond({ revision: 3, phase: 'recording', sessionId: second.sessionId })
    await second.result

    expect(commands).toEqual([
      { sessionId: first.sessionId, command: 'stop' },
      { sessionId: second.sessionId, command: 'stop' }
    ])
  })

  it('keeps A owned when B admission fails and discards A on teardown', async () => {
    let startCount = 0
    request.mockImplementation((route: string, input: any) => {
      if (route === 'ai.voice.session.state') return Promise.resolve({ revision: 1, phase: 'idle' })
      if (route === 'ai.voice.recording.start' && ++startCount === 1) {
        return Promise.resolve({ revision: 2, phase: 'recording', sessionId: input.sessionId })
      }
      if (route === 'ai.voice.recording.start') {
        return Promise.reject(new IpcError('VOICE_BUSY', 'busy'))
      }
      return Promise.resolve(undefined)
    })
    const service = createService()
    await service.initialize()
    const first = service.startRecording({ source: 'dictation' })
    await first.result
    const second = service.startRecording({ source: 'dictation' })
    await expect(second.result).rejects.toMatchObject({ reason: 'busy' })

    await service.teardown()

    const discarded = request.mock.calls
      .filter(([route]) => route === 'ai.voice.session.discard')
      .map(([, input]) => input.sessionId)
    expect(discarded).toEqual([first.sessionId])
  })

  it('stops old state and command subscribers across teardown and reinitialize', async () => {
    let revision = 1
    request.mockImplementation(async (route: string, input: any) => {
      if (route === 'ai.voice.session.state') return { revision: revision++, phase: 'idle' }
      if (route === 'ai.voice.recording.start') {
        return { revision: revision++, phase: 'recording', sessionId: input.sessionId }
      }
      return undefined
    })
    const service = createService()
    const stateListener = vi.fn()
    const commandListener = vi.fn()
    service.subscribe(stateListener)
    service.subscribeCommands(commandListener)
    await service.initialize()
    const first = service.startRecording({ source: 'dictation' })
    await first.result
    stateListener.mockClear()
    commandListener.mockClear()

    await service.teardown()
    await service.initialize()
    const second = service.startRecording({ source: 'dictation' })
    await second.result
    voiceEvent?.({
      type: 'command',
      revision: service.getSnapshot().revision,
      sessionId: second.sessionId,
      command: 'stop'
    })

    expect(stateListener).not.toHaveBeenCalled()
    expect(commandListener).not.toHaveBeenCalled()
  })

  it('discards both current and pending admission sessions during beforeunload', async () => {
    let startCount = 0
    let resolveSecond!: (state: unknown) => void
    request.mockImplementation((route: string, input: any) => {
      if (route === 'ai.voice.session.state') return Promise.resolve({ revision: 1, phase: 'idle' })
      if (route === 'ai.voice.recording.start' && ++startCount === 1) {
        return Promise.resolve({ revision: 2, phase: 'recording', sessionId: input.sessionId })
      }
      if (route === 'ai.voice.recording.start') return new Promise((resolve) => (resolveSecond = resolve))
      return Promise.resolve(undefined)
    })
    const service = createService()
    await service.initialize()
    const first = service.startRecording({ source: 'dictation' })
    await first.result
    const second = service.startRecording({ source: 'dictation' })
    await Promise.resolve()

    ownerWindow.dispatchEvent(new Event('beforeunload'))
    await vi.waitFor(() => {
      const discarded = request.mock.calls
        .filter(([route]) => route === 'ai.voice.session.discard')
        .map(([, input]) => input.sessionId)
      expect(discarded).toEqual([first.sessionId, second.sessionId])
    })
    resolveSecond({ revision: 3, phase: 'recording', sessionId: second.sessionId })
    await second.result
  })

  it('does not replace lease command ownership with an asset installation session', async () => {
    let resolveInstall!: () => void
    request.mockImplementation((route: string, input: any) => {
      if (route === 'ai.voice.session.state') return Promise.resolve({ revision: 1, phase: 'idle' })
      if (route === 'ai.voice.recording.start') {
        return Promise.resolve({ revision: 2, phase: 'recording', sessionId: input.sessionId })
      }
      if (route === 'ai.transcription.asset.install') return new Promise<void>((resolve) => (resolveInstall = resolve))
      return Promise.resolve(undefined)
    })
    const service = createService()
    const commands: string[] = []
    service.subscribeCommands(({ command }) => commands.push(command))
    await service.initialize()
    const recording = service.startRecording({ source: 'dictation' })
    await recording.result
    const install = service.installTranscriptionAsset({ language: 'en-US', source: 'settings' })
    await Promise.resolve()

    voiceEvent?.({ type: 'command', revision: 2, sessionId: recording.sessionId, command: 'stop' })
    expect(commands).toEqual(['stop'])

    await service.teardown()
    const discarded = request.mock.calls
      .filter(([route]) => route === 'ai.voice.session.discard')
      .map(([, input]) => input.sessionId)
    expect(discarded).toEqual([recording.sessionId, install.sessionId])
    resolveInstall()
    await install.result
  })

  it('unsubscribes and discards its owned session during window teardown', async () => {
    request.mockImplementation(async (route: string, input: any) => {
      if (route === 'ai.voice.session.state') return { revision: 1, phase: 'idle' }
      if (route === 'ai.voice.recording.start') {
        return { revision: 2, phase: 'recording', sessionId: input.sessionId }
      }
      return undefined
    })
    const service = createService()
    await service.initialize()
    const operation = service.startRecording({ source: 'dictation' })
    await operation.result

    ownerWindow.dispatchEvent(new Event('beforeunload'))

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('ai.voice.session.discard', { sessionId: operation.sessionId })
    )
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('VoiceService error boundary', () => {
  it('maps stable voice IPC codes without exposing the transport message', async () => {
    request.mockRejectedValueOnce(new IpcError('VOICE_BUSY', 'private native failure'))
    const error = await createService()
      .getMicrophoneStatus()
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(VoiceDomainError)
    expect(error).toMatchObject({ reason: 'busy', message: 'busy' })
    expect(String(error)).not.toContain('private native failure')
  })

  it('maps unknown failures to operation_failed', async () => {
    request.mockRejectedValueOnce(new IpcError('VOICE_FUTURE_FAILURE', 'private provider response'))

    await expect(createService().listVoices()).rejects.toMatchObject({ reason: 'operation_failed' })
  })
})

describe('VoiceService route facade', () => {
  it('generates controlled ids for recording, ASR retry, abort, and discard', async () => {
    request.mockImplementation(async (route: string, input: any) => {
      if (route === 'ai.voice.recording.start') return { revision: 1, phase: 'recording', sessionId: input.sessionId }
      if (route === 'file.voice_recording.create') return { id: 'file-1', origin: 'internal' }
      if (route === 'ai.transcription.generate') {
        return { sessionId: input.sessionId, requestId: input.requestId, text: 'transcript', segments: [] }
      }
      return undefined
    })
    const service = createService()

    const recording = service.startRecording({ source: 'dictation' })
    await recording.result
    await service.createRecording({
      sessionId: recording.sessionId,
      audio: new Uint8Array([1, 2, 3]),
      durationMs: 1200
    })
    const transcription = service.transcribe({ sessionId: recording.sessionId, fileEntryId: 'file-1' })
    await transcription.result
    const retry = service.retryTranscription({ sessionId: recording.sessionId, fileEntryId: 'file-1' })
    await retry.result
    await service.abortTranscription(retry)
    await service.discardSession(recording.sessionId)

    expect(request.mock.calls).toEqual([
      ['ai.voice.recording.start', { sessionId: ids[0], requestId: ids[1], source: 'dictation' }],
      [
        'file.voice_recording.create',
        {
          sessionId: ids[0],
          audio: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/webm;codecs=opus',
          durationMs: 1200
        }
      ],
      ['ai.transcription.generate', { sessionId: ids[0], requestId: ids[2], fileEntryId: 'file-1' }],
      ['ai.transcription.generate', { sessionId: ids[0], requestId: ids[3], fileEntryId: 'file-1' }],
      ['ai.transcription.abort', { sessionId: ids[0], requestId: ids[3] }],
      ['ai.voice.session.discard', { sessionId: ids[0] }]
    ])
  })

  it('keeps speech metadata and audio bytes on their narrow routes', async () => {
    request.mockImplementation(async (route: string, input: any) => {
      if (route === 'ai.speech.generate') {
        return {
          sessionId: input.sessionId,
          requestId: input.requestId,
          fileEntry: { id: 'output-1', origin: 'internal' },
          mimeType: 'audio/wav'
        }
      }
      if (route === 'ai.voice.output.read') return { audio: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav' }
      if (route === 'ai.voice.playback.update' || route === 'ai.voice.playback.control') {
        return { revision: 7, phase: 'playing', sessionId: input.sessionId }
      }
      return undefined
    })
    const service = createService()
    const speech = service.generateSpeech({
      text: 'hello',
      voice: 'voice-id',
      language: 'en-US',
      speed: 1.25,
      source: 'playback',
      trigger: 'auto_read',
      chunkIndex: 0,
      chunkCount: 2
    })
    await speech.result
    await service.readOutput({ sessionId: speech.sessionId, fileEntryId: 'output-1' })
    await service.releaseOutput({ sessionId: speech.sessionId, fileEntryId: 'output-1' })
    await service.updatePlayback({ sessionId: speech.sessionId, phase: 'playing' })
    await service.controlPlayback({ sessionId: speech.sessionId, command: 'pause' })
    await service.abortSpeech(speech)

    expect(request.mock.calls[0]).toEqual([
      'ai.speech.generate',
      {
        sessionId: ids[0],
        requestId: ids[1],
        text: 'hello',
        voice: 'voice-id',
        language: 'en-US',
        speed: 1.25,
        source: 'playback',
        trigger: 'auto_read',
        chunkIndex: 0,
        chunkCount: 2
      }
    ])
    expect(request.mock.calls.slice(1)).toEqual([
      ['ai.voice.output.read', { sessionId: ids[0], fileEntryId: 'output-1' }],
      ['ai.voice.output.release', { sessionId: ids[0], fileEntryId: 'output-1' }],
      ['ai.voice.playback.update', { sessionId: ids[0], phase: 'playing' }],
      ['ai.voice.playback.control', { sessionId: ids[0], command: 'pause' }],
      ['ai.speech.abort', { sessionId: ids[0], requestId: ids[1] }]
    ])
  })

  it('exposes discovery, explicit install, and microphone operations without provider options', async () => {
    request.mockResolvedValue(undefined)
    const service = createService()

    await service.listModels()
    await service.getModelStatus({ modelId: 'local-voice::apple-system-asr', language: 'en-US' })
    await service.listVoices()
    const install = service.installTranscriptionAsset({ language: 'en-US', source: 'settings' })
    await install.result
    await service.getMicrophoneStatus()
    await service.openMicrophoneSettings()

    expect(request.mock.calls).toEqual([
      ['ai.voice.models.list'],
      ['ai.voice.model.status', { modelId: 'local-voice::apple-system-asr', language: 'en-US' }],
      ['ai.speech.voices.list'],
      [
        'ai.transcription.asset.install',
        { sessionId: ids[0], requestId: ids[1], language: 'en-US', source: 'settings' }
      ],
      ['ai.voice.microphone.status'],
      ['ai.voice.microphone.open_settings']
    ])
  })
})

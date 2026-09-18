module.exports = async function runVoiceRuntimeSmoke(expectedUrl, language = 'en-US') {
  const evidence = { schemaVersion: 1, passed: false, stage: 'target', cleanupSucceeded: true, sessionsDiscarded: 0 }
  const sessions = []
  const safeCodes = new Set([
    'VOICE_UNSUPPORTED',
    'VOICE_ASSET_REQUIRED',
    'VOICE_MODEL_REQUIRED',
    'VOICE_LICENSE_UNVERIFIED',
    'VOICE_VOICE_UNAVAILABLE',
    'VOICE_BUSY',
    'VOICE_FORBIDDEN',
    'VOICE_INVALID_AUDIO',
    'VOICE_ABORTED',
    'VOICE_STOPPED',
    'VOICE_INVALID_REQUEST',
    'VOICE_OPERATION_FAILED',
    'VOICE_TIMEOUT',
    'TARGET_MISMATCH',
    'PRELOAD_UNAVAILABLE',
    'INVALID_LANGUAGE',
    'VOICE_NOT_INSTALLED',
    'ASR_NOT_READY',
    'AUDIO_UNSUPPORTED',
    'INVALID_TTS_AUDIO',
    'RECORDING_FAILED',
    'TRANSCRIPT_EMPTY',
    'FUNASR_UNEXPECTED_SUCCESS',
    'CLEANUP_FAILED'
  ])
  let request
  let context
  let destination
  let source
  let recorder
  let recordingTimer
  try {
    if (location.href !== expectedUrl) throw { code: 'TARGET_MISMATCH' }
    if (language !== 'en-US' && language !== 'zh-CN') throw { code: 'INVALID_LANGUAGE' }
    evidence.language = language
    if (typeof window.api?.ipcApi?.request !== 'function') throw { code: 'PRELOAD_UNAVAILABLE' }
    request = async (route, input) => {
      const envelope = await window.api.ipcApi.request(route, input)
      if (envelope?.ok === true) return envelope.data
      if (envelope?.ok === false) throw envelope.error
      throw { code: 'SMOKE_FAILED' }
    }
    evidence.stage = 'voices'
    const voices = await request('ai.speech.voices.list')
    const voice = voices.filter((item) => item.language === language).sort((a, b) => a.id.localeCompare(b.id))[0]
    if (!voice) throw { code: 'VOICE_NOT_INSTALLED' }
    evidence.installedVoiceCount = voices.length
    evidence.selectedVoice = { id: voice.id, language: voice.language }
    evidence.stage = 'asr_status'
    const status = await request('ai.voice.model.status', {
      modelId: 'local-voice::apple-system-asr',
      language
    })
    evidence.appleStatus = { status: status.status }
    if (status.status !== 'ready') throw { code: 'ASR_NOT_READY' }
    if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) throw { code: 'AUDIO_UNSUPPORTED' }

    evidence.stage = 'speech'
    const speechSession = crypto.randomUUID()
    sessions.push(speechSession)
    const speech = await request('ai.speech.generate', {
      sessionId: speechSession,
      requestId: crypto.randomUUID(),
      source: 'automation',
      modelId: 'local-voice::apple-system-tts',
      language,
      voice: voice.id,
      text:
        language === 'zh-CN'
          ? '这是樱桃工作室的本地语音验证。今天天空晴朗，我们正在检查离线语音转写功能。'
          : 'Cherry Studio local voice verification. The bright blue sky is clear today. This recording uses a synthetic voice.'
    })
    evidence.stage = 'read_speech'
    const file = await request('file.read', {
      handle: { kind: 'entry', entryId: speech.fileEntry.id },
      options: { mode: 'full', encoding: 'binary' }
    })
    if (!(file.content instanceof Uint8Array) || !file.content.byteLength || file.content.byteLength > 32 * 1024 * 1024)
      throw { code: 'INVALID_TTS_AUDIO' }
    context = new AudioContext({ sampleRate: 48000 })
    await context.resume()
    const audio = await context.decodeAudioData(new Uint8Array(file.content).buffer)
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 60)
      throw { code: 'INVALID_TTS_AUDIO' }
    evidence.tts = {
      bytes: file.content.byteLength,
      sampleRate: audio.sampleRate,
      channels: audio.numberOfChannels,
      durationSeconds: audio.duration
    }

    evidence.stage = 'record_webm'
    destination = context.createMediaStreamDestination()
    destination.channelCount = 1
    source = context.createBufferSource()
    source.buffer = audio
    source.connect(destination)
    const chunks = []
    recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 })
    const recorded = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => reject({ code: 'RECORDING_FAILED' })
      recorder.onstop = resolve
      source.onended = () => {
        if (recorder.state === 'recording') recorder.stop()
      }
      recordingTimer = setTimeout(() => reject({ code: 'RECORDING_FAILED' }), Math.ceil(audio.duration * 1000) + 5000)
    })
    recorder.start()
    source.start()
    await recorded
    clearTimeout(recordingTimer)
    const webm = new Uint8Array(await new Blob(chunks, { type: 'audio/webm;codecs=opus' }).arrayBuffer())
    if (webm.byteLength < 4 || webm.byteLength > 32 * 1024 * 1024) throw { code: 'RECORDING_FAILED' }
    evidence.recording = { bytes: webm.byteLength, mimeType: 'audio/webm;codecs=opus' }

    evidence.stage = 'apple_upload'
    const appleSession = crypto.randomUUID()
    sessions.push(appleSession)
    const recording = await request('file.voice_recording.create', {
      sessionId: appleSession,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus'
    })
    evidence.stage = 'apple_transcribe'
    const transcript = await request('ai.transcription.generate', {
      sessionId: appleSession,
      requestId: crypto.randomUUID(),
      source: 'automation',
      modelId: 'local-voice::apple-system-asr',
      language,
      fileEntryId: recording.id
    })
    if (typeof transcript.text !== 'string' || !transcript.text.trim()) throw { code: 'TRANSCRIPT_EMPTY' }
    evidence.apple = { transcriptNonEmpty: true, durationSeconds: transcript.durationInSeconds }

    evidence.stage = 'funasr_upload'
    const funasrSession = crypto.randomUUID()
    sessions.push(funasrSession)
    const funasrRecording = await request('file.voice_recording.create', {
      sessionId: funasrSession,
      audio: webm,
      mimeType: 'audio/webm;codecs=opus'
    })
    evidence.stage = 'funasr_refusal'
    try {
      await request('ai.transcription.generate', {
        sessionId: funasrSession,
        requestId: crypto.randomUUID(),
        source: 'automation',
        modelId: 'local-voice::funasr-nano',
        language,
        fileEntryId: funasrRecording.id
      })
      throw { code: 'FUNASR_UNEXPECTED_SUCCESS' }
    } catch (error) {
      if (error?.code !== 'VOICE_LICENSE_UNVERIFIED') throw error
      evidence.funasr = { status: 'refused', reason: 'license_unverified' }
    }
    evidence.passed = true
    evidence.stage = 'complete'
  } catch (error) {
    evidence.code = safeCodes.has(error?.code) ? error.code : 'SMOKE_FAILED'
  } finally {
    clearTimeout(recordingTimer)
    if (source) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* The source may already have ended. */
      }
      source.disconnect()
    }
    if (recorder?.state === 'recording') recorder.stop()
    for (const track of destination?.stream.getTracks() ?? []) track.stop()
    if (context)
      await context.close().catch(() => {
        evidence.cleanupSucceeded = false
      })
    for (const sessionId of sessions) {
      try {
        await request('ai.voice.session.discard', { sessionId })
        evidence.sessionsDiscarded += 1
      } catch {
        evidence.cleanupSucceeded = false
      }
    }
    if (!evidence.cleanupSucceeded) {
      evidence.passed = false
      evidence.code = 'CLEANUP_FAILED'
    }
  }
  return evidence
}

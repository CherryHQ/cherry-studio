import { application } from '@application'
import { VoiceRuntimeError, voiceIpcError } from '@main/ai/voice/VoiceRuntimeError'
import type { VoiceOwner, VoiceSessionService } from '@main/ai/voice/VoiceSessionService'
import type { voiceRequestSchemas } from '@shared/ipc/schemas/voice'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'

async function callVoice<T>(
  senderId: WindowId | null,
  operation: (service: VoiceSessionService, owner: VoiceOwner) => T | Promise<T>
): Promise<T> {
  try {
    const webContents = senderId ? application.get('WindowManager').getWindow(senderId)?.webContents : undefined
    if (!senderId || !webContents || webContents.isDestroyed()) throw new VoiceRuntimeError('forbidden_owner')
    return await operation(application.get('VoiceSessionService'), { windowId: senderId, webContents })
  } catch (error) {
    throw voiceIpcError(error)
  }
}

export const voiceHandlers: IpcHandlersFor<typeof voiceRequestSchemas> = {
  'ai.voice.resources.open_settings': (_input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.openSystemVoiceSettings(owner)),
  'ai.voice.transcription.resolve': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.resolveTranscription(owner, input)),
  'ai.voice.speech.resolve': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.resolveSpeech(owner, input)),
  'file.voice_recording.create': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.createRecording(owner, input)),
  'ai.speech.generate': (input, { senderId }) => callVoice(senderId, (service, owner) => service.speech(owner, input)),
  'ai.speech.abort': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.abort(owner, input, 'speech')),
  'ai.transcription.generate': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.transcribe(owner, input)),
  'ai.transcription.abort': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.abort(owner, input, 'transcription')),
  'ai.voice.session.state': (_input, { senderId }) => callVoice(senderId, (service, owner) => service.getState(owner)),
  'ai.voice.recording.start': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.startRecording(owner, input)),
  'ai.voice.output.release': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.releaseOutput(owner, input)),
  'ai.voice.playback.report': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.reportPlayback(owner, input)),
  'ai.voice.playback.control': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.controlPlayback(owner, input)),
  'ai.voice.microphone.status': (_input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.getMicrophoneStatus(owner)),
  'ai.voice.microphone.open_settings': (_input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.openMicrophoneSettings(owner)),
  'ai.voice.session.discard': ({ sessionId }, { senderId }) =>
    callVoice(senderId, (service, owner) => service.discard(owner, sessionId)),
  'ai.voice.models.list': (_input, { senderId }) => callVoice(senderId, (service) => service.listModels()),
  'ai.voice.model.describe': (input, { senderId }) =>
    callVoice(senderId, (service) => service.describeModel(input.modelId)),
  'ai.voice.model.download': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.downloadModel(owner, input.modelId)),
  'ai.voice.model.cancel_download': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.cancelModelDownload(owner, input.modelId)),
  'ai.voice.model.remove': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.removeModel(owner, input.modelId)),
  'ai.transcription.locales.list': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.listTranscriptionLocales(owner, input.modelId)),
  'ai.voice.model.status': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.status(owner, input)),
  'ai.speech.voices.list': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.voices(owner, input.modelId)),
  'ai.transcription.asset.install': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.installAsset(owner, input))
}

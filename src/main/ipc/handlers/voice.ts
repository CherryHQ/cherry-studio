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
  'ai.voice.output.read': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.readOutput(owner, input)),
  'ai.voice.output.release': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.releaseOutput(owner, input)),
  'ai.voice.playback.update': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.updatePlayback(owner, input)),
  'ai.voice.playback.control': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.controlPlayback(owner, input)),
  'ai.voice.microphone.status': (_input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.getMicrophoneStatus(owner)),
  'ai.voice.microphone.open_settings': (_input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.openMicrophoneSettings(owner)),
  'ai.voice.session.discard': ({ sessionId }, { senderId }) =>
    callVoice(senderId, (service, owner) => service.discard(owner, sessionId)),
  'ai.voice.models.list': (_input, { senderId }) => callVoice(senderId, (service) => service.listModels()),
  'ai.transcription.locales.list': (_input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.listTranscriptionLocales(owner)),
  'ai.voice.model.status': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.status(owner, input)),
  'ai.speech.voices.list': (_input, { senderId }) => callVoice(senderId, (service, owner) => service.voices(owner)),
  'ai.transcription.asset.install': (input, { senderId }) =>
    callVoice(senderId, (service, owner) => service.installAsset(owner, input))
}

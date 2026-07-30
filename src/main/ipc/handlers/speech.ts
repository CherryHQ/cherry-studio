import { application } from '@application'
import type { speechRequestSchemas } from '@shared/ipc/schemas/speech'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const speechHandlers: IpcHandlersFor<typeof speechRequestSchemas> = {
  'speech.capabilities': async () => application.get('SpeechSessionService').capabilities(),
  'speech.transcribe': (input) => application.get('SpeechSessionService').transcribe(input),
  'speech.synthesize': (input) => application.get('SpeechSessionService').synthesize(input),
  'speech.evaluate': (input) => application.get('SpeechSessionService').evaluate(input),
  'speech.scenario_reply': (input) => application.get('SpeechSessionService').scenarioReply(input),
  'speech.realtime_sdp': (input) => application.get('SpeechSessionService').createRealtimeSdpAnswer(input),
  'speech.cancel': async ({ sessionId }) => application.get('SpeechSessionService').cancel(sessionId)
}

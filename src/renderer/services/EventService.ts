import Emittery from 'emittery'

export const EventEmitter = new Emittery()

export const EVENT_NAMES = {
  SEND_MESSAGE: 'SEND_MESSAGE',
  EDIT_MESSAGE: 'EDIT_MESSAGE',
  CHAT_COMPLETION_PAUSED: 'CHAT_COMPLETION_PAUSED',
  SWITCH_TOPIC_SIDEBAR: 'SWITCH_TOPIC_SIDEBAR',
  COPY_TOPIC_IMAGE: 'COPY_TOPIC_IMAGE',
  EXPORT_TOPIC_IMAGE: 'EXPORT_TOPIC_IMAGE',
  LOCATE_MESSAGE: 'LOCATE_MESSAGE',
  CHANGE_TOPIC: 'CHANGE_TOPIC',
  FOCUS_CHAT_COMPOSER: 'FOCUS_CHAT_COMPOSER',
  INSERT_AGENT_COMPOSER_TOKEN: 'INSERT_AGENT_COMPOSER_TOKEN',
  ATTACH_AGENT_COMPOSER_PATH: 'ATTACH_AGENT_COMPOSER_PATH',
  ADD_CHAT_COMPOSER_IMAGE_REFERENCE: 'ADD_CHAT_COMPOSER_IMAGE_REFERENCE',
  INSERT_COMPOSER_SELECTION_REFERENCE: 'INSERT_COMPOSER_SELECTION_REFERENCE',
  GLOBAL_SEARCH_SELECT_TOPIC: 'GLOBAL_SEARCH_SELECT_TOPIC',
  GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE: 'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
  GLOBAL_SEARCH_SELECT_AGENT_SESSION: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION',
  GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE',
  GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE: 'GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE',
  REVEAL_ACTIVE_RESOURCE_LIST: 'REVEAL_ACTIVE_RESOURCE_LIST',
  OPEN_RESOURCE_EDIT_DIALOG: 'OPEN_RESOURCE_EDIT_DIALOG'
}

export type GeneratedTextAttachmentResult =
  | { kind: 'attached'; attachmentId: string }
  | { kind: 'cancelled' | 'unavailable' | 'failed' }
export interface GeneratedTextAttachmentRequest {
  intentId: string
  topicId: string
  name: string
  capture: (signal: AbortSignal) => Promise<string>
  claim: (receive: () => Promise<GeneratedTextAttachmentResult>) => boolean
}
const generatedTextEvents = new Emittery<{ request: GeneratedTextAttachmentRequest }>()
export const onGeneratedTextAttachment = (listener: (request: GeneratedTextAttachmentRequest) => void) =>
  generatedTextEvents.on('request', listener)

/** The active Composer binds its draft before invoking the source capture. */
export async function attachGeneratedText(
  input: Omit<GeneratedTextAttachmentRequest, 'claim'>
): Promise<GeneratedTextAttachmentResult> {
  let accepted: Promise<GeneratedTextAttachmentResult> | undefined
  await generatedTextEvents.emit('request', {
    ...input,
    claim: (receive) => {
      if (accepted) return false
      accepted = receive()
      return true
    }
  })
  return accepted ?? { kind: 'unavailable' }
}

import Emittery from 'emittery'

import type { ComposerDraftToken } from '@renderer/types/composer'
import type {
  GlobalSearchAgentSessionMessageSelectionPayload,
  GlobalSearchAgentSessionSelectionPayload,
  GlobalSearchTopicMessageSelectionPayload,
  GlobalSearchTopicSelectionPayload
} from '@renderer/types/globalSearch'
import type { ResourceEditDialogTarget, ResourceListRevealPayload } from '@renderer/types/resourceCatalog'
import type { ComposerFileReference } from '@renderer/types/selectionReference'
import type { Topic } from '@renderer/types/topic'

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
} as const

export type RendererEvents = {
  [EVENT_NAMES.SEND_MESSAGE]: { topicId: string }
  [EVENT_NAMES.EDIT_MESSAGE]: string
  [EVENT_NAMES.COPY_TOPIC_IMAGE]: Topic
  [EVENT_NAMES.EXPORT_TOPIC_IMAGE]: Topic
  [EVENT_NAMES.CHANGE_TOPIC]: Topic
  [EVENT_NAMES.FOCUS_CHAT_COMPOSER]: { topicId: string }
  [EVENT_NAMES.INSERT_AGENT_COMPOSER_TOKEN]: {
    topicId: string
    token: ComposerDraftToken
    updateOnly?: boolean
  }
  [EVENT_NAMES.ATTACH_AGENT_COMPOSER_PATH]: {
    topicId: string
    path: string
    kind: 'file' | 'directory'
    name?: string
  }
  [EVENT_NAMES.ADD_CHAT_COMPOSER_IMAGE_REFERENCE]: { topicId: string; url: string; name: string }
  [EVENT_NAMES.INSERT_COMPOSER_SELECTION_REFERENCE]: { topicId: string; reference: ComposerFileReference }
  [EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC]: GlobalSearchTopicSelectionPayload
  [EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE]: GlobalSearchTopicMessageSelectionPayload
  [EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION]: GlobalSearchAgentSessionSelectionPayload
  [EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE]: GlobalSearchAgentSessionMessageSelectionPayload
  [EVENT_NAMES.GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE]: string
  [EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST]: ResourceListRevealPayload
  [EVENT_NAMES.OPEN_RESOURCE_EDIT_DIALOG]: ResourceEditDialogTarget
  [messageEvent: `${typeof EVENT_NAMES.LOCATE_MESSAGE}:${string}`]: boolean | undefined
}

export const EventEmitter = new Emittery<RendererEvents>()

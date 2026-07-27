import type { DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { MessageListActions, MessageListItem, MessageStreamingLayers } from '../types'
import { useMessageActivityState } from './useMessageActivityState'
import { useMessageErrorActions } from './useMessageErrorActions'
import { useMessageExportActions } from './useMessageExportActions'
import { useMessageHeaderCapabilities } from './useMessageHeaderCapabilities'
import { useMessageLeafCapabilities } from './useMessageLeafCapabilities'
import { useMessageListRenderConfig } from './useMessageListRenderConfig'
import { useMessageMenuConfig } from './useMessageMenuConfig'
import { useMessageSelectionController } from './useMessageSelectionController'
import { useMessageUiStateCache } from './useMessageUiStateCache'

interface UseMessageListAdapterCapabilitiesOptions {
  topicId: string
  topicName: string
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
}

/**
 * Shared message-list adapter wiring. Domain adapters keep their own data,
 * mutations, and actions; this hook only assembles the common UI capabilities.
 */
export function useMessageListAdapterCapabilities({
  topicId,
  topicName,
  partsByMessageId,
  streamingLayers
}: UseMessageListAdapterCapabilitiesOptions) {
  const getMessageActivityState = useMessageActivityState(topicId, partsByMessageId)
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const menuConfig = useMessageMenuConfig()
  const exportActions = useMessageExportActions({ topicName })
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId, streamingLayers })
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()

  return {
    exportActions,
    getMessageActivityState,
    headerCapabilities,
    leafCapabilities,
    menuConfig,
    messageUiStateCache,
    renderConfig,
    updateRenderConfig
  }
}

interface UseMessageListAdapterInteractionCapabilitiesOptions {
  topicId: string
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  deleteMessage?: MessageListActions['deleteMessage']
  saveTextFile?: MessageListActions['saveTextFile']
  copyRichContent?: MessageListActions['copyRichContent']
  persistDiagnosis?: (partId: string, diagnosis: DiagnosisResult) => void | Promise<void>
}

export function useMessageListAdapterInteractionCapabilities({
  topicId,
  messages,
  partsByMessageId,
  deleteMessage,
  saveTextFile,
  copyRichContent,
  persistDiagnosis
}: UseMessageListAdapterInteractionCapabilitiesOptions) {
  const errorActions = useMessageErrorActions({ persistDiagnosis })
  const selectionController = useMessageSelectionController({
    topicId,
    messages,
    partsByMessageId,
    deleteMessage,
    saveTextFile,
    copyRichContent
  })

  return { errorActions, selectionController }
}

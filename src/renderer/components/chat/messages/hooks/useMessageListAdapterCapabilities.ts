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
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
  deleteMessage?: MessageListActions['deleteMessage']
  persistDiagnosis?: (partId: string, diagnosis: DiagnosisResult) => void | Promise<void>
}

/**
 * Shared message-list adapter wiring. Domain adapters inject their own data,
 * mutations, and persistence; this hook assembles the common UI capabilities,
 * including the export/copy feed into the selection controller.
 */
export function useMessageListAdapterCapabilities({
  topicId,
  topicName,
  messages,
  partsByMessageId,
  streamingLayers,
  deleteMessage,
  persistDiagnosis
}: UseMessageListAdapterCapabilitiesOptions) {
  const getMessageActivityState = useMessageActivityState(topicId, partsByMessageId)
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const menuConfig = useMessageMenuConfig()
  const exportActions = useMessageExportActions({ topicName })
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId, streamingLayers })
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()
  const errorActions = useMessageErrorActions({ persistDiagnosis })
  const selectionController = useMessageSelectionController({
    topicId,
    messages,
    partsByMessageId,
    deleteMessage,
    saveTextFile: exportActions.saveTextFile,
    copyRichContent: leafCapabilities.copyRichContent
  })

  return {
    errorActions,
    exportActions,
    getMessageActivityState,
    headerCapabilities,
    leafCapabilities,
    menuConfig,
    messageUiStateCache,
    renderConfig,
    selectionController,
    updateRenderConfig
  }
}

import { useKnowledgeBaseCtx, useKnowledgeUICtx } from '../../context'
import type { AddAction } from './types'
import { useAddDirectoryAction } from './useAddDirectoryAction'
import { useAddFileAction } from './useAddFileAction'
import { useAddNoteAction } from './useAddNoteAction'
import { useAddSitemapAction } from './useAddSitemapAction'
import { useAddUrlAction } from './useAddUrlAction'

export type { AddAction }

export const useKnowledgeTabAddAction = (): AddAction => {
  const { selectedBase } = useKnowledgeBaseCtx()
  const { activeTab } = useKnowledgeUICtx()

  const baseId = selectedBase?.id ?? ''
  const baseDisabled = !selectedBase?.embeddingModelId

  const fileAction = useAddFileAction(baseId, baseDisabled)
  const noteAction = useAddNoteAction(baseId, baseDisabled)
  const directoryAction = useAddDirectoryAction(baseId, baseDisabled)
  const urlAction = useAddUrlAction(baseId, baseDisabled)
  const sitemapAction = useAddSitemapAction(baseId, baseDisabled)

  const actionsByTab: Record<string, AddAction> = {
    files: fileAction,
    notes: noteAction,
    directories: directoryAction,
    urls: urlAction,
    sitemaps: sitemapAction
  }

  return actionsByTab[activeTab]
}

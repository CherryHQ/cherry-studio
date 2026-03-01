import { Button } from '@cherrystudio/ui'
import { History, Search, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeBaseCtx, useKnowledgeQueueCtx, useKnowledgeUICtx } from '../context'

const KnowledgeToolbar: FC = () => {
  const { t } = useTranslation()
  const { selectedBase } = useKnowledgeBaseCtx()
  const { openEditDialog, openSearchDialog } = useKnowledgeUICtx()
  const { hasOrphans, orphanCount, handleRecover, handleIgnore, isRecovering, isIgnoring } = useKnowledgeQueueCtx()

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-row items-center justify-between border-border border-b px-4 py-2">
      <div className="flex flex-row items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={openEditDialog}>
          <Settings size={18} color="var(--color-icon)" />
        </Button>
        <div className="rounded-3xs border border-amber-400/20 bg-amber-400/10 px-2 text-amber-400 text-xs">
          {selectedBase.embeddingModelMeta?.name ?? selectedBase.embeddingModelId}
        </div>
        {selectedBase.rerankModelMeta && (
          <div className="rounded-3xs border border-orange-400/20 bg-orange-400/10 px-2 text-orange-400 text-xs">
            {selectedBase.rerankModelMeta.name}
          </div>
        )}
        {selectedBase.fileProcessorId && (
          <div className="rounded-3xs border border-teal-500/20 bg-teal-500/10 px-2 text-teal-500 text-xs">
            {selectedBase.fileProcessorId}
          </div>
        )}
      </div>
      <div className="flex flex-row items-center gap-2">
        {hasOrphans && (
          <>
            <Button
              className="h-8 rounded-2xs"
              variant="secondary"
              size="sm"
              onClick={handleRecover}
              disabled={isRecovering || isIgnoring}>
              <History size={14} className={isRecovering ? 'animate-spin' : ''} />
              {t('knowledge.recover_orphans', { count: orphanCount })}
            </Button>
            <Button
              className="h-8 rounded-2xs"
              variant="secondary"
              size="sm"
              onClick={handleIgnore}
              disabled={isRecovering || isIgnoring}>
              {t('knowledge.ignore_orphans')}
            </Button>
          </>
        )}

        <Button className="hover:opacity-70" size="icon-sm" variant="ghost" onClick={openSearchDialog}>
          <Search size={18} />
        </Button>
      </div>
    </div>
  )
}

export default KnowledgeToolbar

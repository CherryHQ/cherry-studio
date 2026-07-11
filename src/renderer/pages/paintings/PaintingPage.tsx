import { SegmentedControl } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { type FC, lazy, Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasActions } from './components/canvas/canvasActions'
import PaintingListView from './components/list/PaintingListView'
import { usePaintingWorkspace } from './hooks/usePaintingWorkspace'
import { paintingClasses } from './paintingPrimitives'

// React Flow is heavy; keep it (and the whole canvas) out of the main bundle.
const CanvasView = lazy(() => import('./components/canvas/CanvasView'))

const PaintingPage: FC = () => {
  const { t } = useTranslation()
  const ws = usePaintingWorkspace()
  const [view, setView] = usePersistCache('ui.painting.view')

  const canvasActions = useMemo<CanvasActions>(
    () => ({
      onEdit: ws.onEdit,
      onRegenerate: ws.onRegenerate,
      onAddToChat: ws.onAddToChat,
      onDelete: ws.onDelete,
      onDownload: ws.onDownload,
      onCopyPrompt: ws.onCopyPrompt,
      onResize: ws.onResize,
      onRetry: ws.onRetry
    }),
    [ws.onEdit, ws.onRegenerate, ws.onAddToChat, ws.onDelete, ws.onDownload, ws.onCopyPrompt, ws.onResize, ws.onRetry]
  )

  return (
    <div className={paintingClasses.page}>
      <div id="content-container" className={paintingClasses.content}>
        <div className={paintingClasses.tabsWrap}>
          <SegmentedControl
            size="sm"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'canvas', label: t('paintings.view.canvas') },
              { value: 'list', label: t('paintings.view.list') }
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={paintingClasses.frame}>
            <div className={paintingClasses.surface}>
              {view === 'list' ? (
                <PaintingListView
                  items={ws.items}
                  inflightCards={ws.inflightCards}
                  hasMore={ws.hasMore}
                  loadMore={ws.loadMore}
                  composer={ws.composer}
                  onEdit={ws.onEdit}
                  onRegenerate={ws.onRegenerate}
                  onAddToChat={ws.onAddToChat}
                  onDownload={ws.onDownload}
                  onCopyPrompt={ws.onCopyPrompt}
                  onDelete={ws.onDelete}
                  onRetry={ws.onRetry}
                />
              ) : (
                <Suspense fallback={null}>
                  <CanvasView
                    items={ws.items}
                    inflightCards={ws.inflightCards}
                    selectedId={ws.selectedId}
                    actions={canvasActions}
                    onSelect={ws.onSelect}
                    onMovePainting={ws.onMove}
                    onUngroup={ws.onUngroup}
                    onDeselect={ws.onDeselect}
                    onAddBoard={ws.onAddBoard}
                    onUploadAsset={ws.onUploadAsset}
                    composer={ws.composer}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPage

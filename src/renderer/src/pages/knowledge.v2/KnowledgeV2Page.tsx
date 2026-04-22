import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigator from './components/BaseNavigator'
import CreateKnowledgeBaseDialog from './components/CreateKnowledgeBaseDialog'
import DetailHeader from './components/DetailHeader'
import DetailTabs from './components/DetailTabs'
import { useCreateKnowledgeBase, useKnowledgeBases, useKnowledgeItems } from './hooks'
import DataSourcePanel from './panels/dataSource/DataSourcePanel'
import RagConfigPanel from './panels/ragConfig/RagConfigPanel'
import RecallTestPanel from './panels/recallTest/RecallTestPanel'
import type { KnowledgeTabKey } from './types'

const NAVIGATOR_DEFAULT_WIDTH = 180
const NAVIGATOR_MIN_WIDTH = 180
const NAVIGATOR_MAX_WIDTH = 360

const KnowledgeV2Page = () => {
  const { t } = useTranslation()
  const { bases, isLoading } = useKnowledgeBases()
  const { createBase, isCreating } = useCreateKnowledgeBase()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [selectedBaseId, setSelectedBaseId] = useState('')
  const [pendingSelectedBaseId, setPendingSelectedBaseId] = useState<string | null>(null)
  const { items: selectedBaseItems, isLoading: isItemsLoading } = useKnowledgeItems(selectedBaseId)
  const [activeTab, setActiveTab] = useState<KnowledgeTabKey>('data')
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const isResizingRef = useRef(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const selectedBase = useMemo(() => {
    return bases.find((base) => base.id === selectedBaseId)
  }, [bases, selectedBaseId])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (bases.length === 0) {
      if (!pendingSelectedBaseId && selectedBaseId) {
        setSelectedBaseId('')
      }
      return
    }

    if (pendingSelectedBaseId) {
      if (bases.some((base) => base.id === pendingSelectedBaseId)) {
        setPendingSelectedBaseId(null)
      }
      return
    }

    const hasSelectedBase = bases.some((base) => base.id === selectedBaseId)
    if (!selectedBaseId || !hasSelectedBase) {
      setSelectedBaseId(bases[0].id)
    }
  }, [bases, pendingSelectedBaseId, selectedBaseId])

  const handleSelectBase = useCallback((baseId: string) => {
    setPendingSelectedBaseId(null)
    setSelectedBaseId(baseId)
  }, [])

  const handleCreateBaseCreated = useCallback((createdBase: { id: string }) => {
    setPendingSelectedBaseId(createdBase.id)
    setSelectedBaseId(createdBase.id)
  }, [])

  const startNavigatorResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    isResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const containerLeft = contentRef.current?.getBoundingClientRect().left ?? 0

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) {
        return
      }

      const nextWidth = moveEvent.clientX - containerLeft
      setNavigatorWidth(Math.min(NAVIGATOR_MAX_WIDTH, Math.max(NAVIGATOR_MIN_WIDTH, nextWidth)))
    }

    const cleanup = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = null
    }

    const onMouseUp = () => cleanup()

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    resizeCleanupRef.current = cleanup
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge_v2.title')}</NavbarCenter>
      </Navbar>

      <div
        ref={contentRef}
        className="flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-1 overflow-hidden bg-background">
        <BaseNavigator
          bases={bases}
          width={navigatorWidth}
          selectedBaseId={selectedBaseId}
          onSelectBase={handleSelectBase}
          onCreateBase={() => setIsCreateDialogOpen(true)}
          onResizeStart={startNavigatorResize}
        />

        {selectedBase ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <DetailHeader base={selectedBase} />
            <DetailTabs activeTab={activeTab} dataSourceCount={selectedBaseItems.length} onChange={setActiveTab} />

            <div className="min-h-0 flex-1 overflow-hidden">
              {activeTab === 'data' && <DataSourcePanel items={selectedBaseItems} isLoading={isItemsLoading} />}
              {activeTab === 'rag' && <RagConfigPanel base={selectedBase} />}
              {activeTab === 'recall' && <RecallTestPanel />}
            </div>
          </main>
        ) : (
          <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background px-6 text-muted-foreground text-sm">
            {isLoading ? t('common.loading') : t('knowledge_v2.empty')}
          </main>
        )}
      </div>

      {isCreateDialogOpen ? (
        <CreateKnowledgeBaseDialog
          open={isCreateDialogOpen}
          isCreating={isCreating}
          createBase={createBase}
          onOpenChange={setIsCreateDialogOpen}
          onCreated={handleCreateBaseCreated}
        />
      ) : null}
    </div>
  )
}

export default KnowledgeV2Page

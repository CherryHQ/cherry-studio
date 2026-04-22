import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigator from './components/BaseNavigator'
import DetailHeader from './components/DetailHeader'
import DetailTabs from './components/DetailTabs'
import { useKnowledgeV2Bases } from './hooks/useKnowledgeV2Bases'
import { useKnowledgeV2Items } from './hooks/useKnowledgeV2Items'
import DataSourcePanel from './panels/dataSource/DataSourcePanel'
import RagConfigPanel from './panels/ragConfig/RagConfigPanel'
import RecallTestPanel from './panels/recallTest/RecallTestPanel'
import type { KnowledgeV2TabKey } from './types'
import { buildKnowledgeV2BaseListItems, type KnowledgeV2BaseListPatch } from './utils/baseList'

const NAVIGATOR_DEFAULT_WIDTH = 180
const NAVIGATOR_MIN_WIDTH = 180
const NAVIGATOR_MAX_WIDTH = 360

const knowledgeBaseListPatches: Partial<Record<string, KnowledgeV2BaseListPatch>> = {
  'ai-tech-docs': { itemCount: 10, status: 'completed' },
  'design-specs': { itemCount: 5, status: 'completed' },
  'api-docs': { itemCount: 6, status: 'processing' },
  'analysis-reports': { itemCount: 4, status: 'completed' },
  'reading-notes': { itemCount: 7, status: 'completed' },
  'travel-plans': { itemCount: 3, status: 'completed' },
  recipes: { itemCount: 4, status: 'failed' },
  'cherry-v2': { itemCount: 8, status: 'processing' },
  'ml-papers': { itemCount: 6, status: 'completed' }
}

const KnowledgeV2Page = () => {
  const { t } = useTranslation()
  const { bases, isLoading } = useKnowledgeV2Bases()
  const [selectedBaseId, setSelectedBaseId] = useState('')
  const { items: selectedBaseItems, isLoading: isItemsLoading } = useKnowledgeV2Items(selectedBaseId)
  const [activeTab, setActiveTab] = useState<KnowledgeV2TabKey>('dataSource')
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const isResizingRef = useRef(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const knowledgeBaseListItems = useMemo(() => buildKnowledgeV2BaseListItems(bases, knowledgeBaseListPatches), [bases])
  const navigatorBaseListItems = useMemo(() => {
    return knowledgeBaseListItems.map((base) => {
      if (base.base.id !== selectedBaseId) {
        return base
      }

      return {
        ...base,
        itemCount: selectedBaseItems.length
      }
    })
  }, [knowledgeBaseListItems, selectedBaseId, selectedBaseItems.length])

  const selectedBase = useMemo(() => {
    return navigatorBaseListItems.find((base) => base.base.id === selectedBaseId)
  }, [navigatorBaseListItems, selectedBaseId])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (knowledgeBaseListItems.length === 0) {
      if (selectedBaseId) {
        setSelectedBaseId('')
      }
      return
    }

    const hasSelectedBase = knowledgeBaseListItems.some((base) => base.base.id === selectedBaseId)
    if (!selectedBaseId || !hasSelectedBase) {
      setSelectedBaseId(knowledgeBaseListItems[0].base.id)
    }
  }, [knowledgeBaseListItems, selectedBaseId])

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
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge.title')}</NavbarCenter>
      </Navbar>

      <div
        ref={contentRef}
        className="flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-1 overflow-hidden bg-background">
        <BaseNavigator
          bases={navigatorBaseListItems}
          width={navigatorWidth}
          selectedBaseId={selectedBaseId}
          onSelectBase={setSelectedBaseId}
          onCreateBase={() => undefined}
          onResizeStart={startNavigatorResize}
        />

        {selectedBase ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <DetailHeader base={selectedBase} />
            <DetailTabs activeTab={activeTab} dataSourceCount={selectedBaseItems.length} onChange={setActiveTab} />

            <div className="min-h-0 flex-1 overflow-hidden">
              {activeTab === 'dataSource' && <DataSourcePanel items={selectedBaseItems} isLoading={isItemsLoading} />}
              {activeTab === 'ragConfig' && <RagConfigPanel base={selectedBase.base} />}
              {activeTab === 'recallTest' && <RecallTestPanel />}
            </div>
          </main>
        ) : (
          <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background px-6 text-muted-foreground text-sm">
            {isLoading ? t('common.loading') : t('knowledge.empty')}
          </main>
        )}
      </div>
    </div>
  )
}

export default KnowledgeV2Page

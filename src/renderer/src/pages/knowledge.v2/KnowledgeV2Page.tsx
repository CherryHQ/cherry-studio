import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigator from './components/BaseNavigator'
import DetailHeader from './components/DetailHeader'
import DetailTabs from './components/DetailTabs'
import DataSourcePanel from './panels/dataSource/DataSourcePanel'
import RagConfigPanel from './panels/ragConfig/RagConfigPanel'
import RecallTestPanel from './panels/recallTest/RecallTestPanel'
import type { KnowledgeV2Base, KnowledgeV2TabKey } from './types'

const NAVIGATOR_DEFAULT_WIDTH = 180
const NAVIGATOR_MIN_WIDTH = 180
const NAVIGATOR_MAX_WIDTH = 360

const knowledgeBases: KnowledgeV2Base[] = [
  {
    id: 'ai-tech-docs',
    name: 'AI 技术文档',
    group: 'work',
    itemCount: 10,
    status: 'ready',
    updatedAt: '2026-04-21T10:40:00+08:00',
    icon: '🤖',
    iconClassName: 'bg-cyan-500/10 text-cyan-500'
  },
  {
    id: 'design-specs',
    name: '产品设计规范',
    group: 'work',
    itemCount: 5,
    status: 'ready',
    updatedAt: '2026-04-20T18:30:00+08:00',
    icon: '🎨',
    iconClassName: 'bg-fuchsia-500/10 text-fuchsia-500'
  },
  {
    id: 'api-docs',
    name: 'API 接口文档',
    group: 'work',
    itemCount: 6,
    status: 'processing',
    updatedAt: '2026-04-21T09:00:00+08:00',
    icon: '🛰️',
    iconClassName: 'bg-blue-500/10 text-blue-500'
  },
  {
    id: 'analysis-reports',
    name: '竞品分析报告',
    group: 'work',
    itemCount: 4,
    status: 'ready',
    updatedAt: '2026-04-19T14:20:00+08:00',
    icon: '📊',
    iconClassName: 'bg-amber-500/10 text-amber-500'
  },
  {
    id: 'reading-notes',
    name: '阅读笔记',
    group: 'personal',
    itemCount: 7,
    status: 'ready',
    updatedAt: '2026-04-18T20:00:00+08:00',
    icon: '📚',
    iconClassName: 'bg-emerald-500/10 text-emerald-500'
  },
  {
    id: 'travel-plans',
    name: '旅行攻略',
    group: 'personal',
    itemCount: 3,
    status: 'ready',
    updatedAt: '2026-04-16T09:45:00+08:00',
    icon: '✈️',
    iconClassName: 'bg-sky-500/10 text-sky-500'
  },
  {
    id: 'recipes',
    name: '食谱收藏',
    group: 'personal',
    itemCount: 4,
    status: 'failed',
    updatedAt: '2026-04-15T15:15:00+08:00',
    icon: '🍳',
    iconClassName: 'bg-orange-500/10 text-orange-500'
  },
  {
    id: 'cherry-v2',
    name: 'Cherry Studio V2',
    group: 'project',
    itemCount: 8,
    status: 'processing',
    updatedAt: '2026-04-21T09:20:00+08:00',
    icon: '🍒',
    iconClassName: 'bg-rose-500/10 text-rose-500'
  },
  {
    id: 'ml-papers',
    name: '机器学习论文集',
    group: 'project',
    itemCount: 6,
    status: 'ready',
    updatedAt: '2026-04-20T11:10:00+08:00',
    icon: '🧠',
    iconClassName: 'bg-violet-500/10 text-violet-500'
  }
]

const KnowledgeV2Page = () => {
  const { t } = useTranslation()
  const [selectedBaseId, setSelectedBaseId] = useState(knowledgeBases[0]?.id ?? '')
  const [activeTab, setActiveTab] = useState<KnowledgeV2TabKey>('dataSource')
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const isResizingRef = useRef(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const selectedBase = useMemo(() => {
    return knowledgeBases.find((base) => base.id === selectedBaseId) ?? knowledgeBases[0]
  }, [selectedBaseId])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
    }
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

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge.title')}</NavbarCenter>
      </Navbar>

      <div
        ref={contentRef}
        className="flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-1 overflow-hidden bg-background">
        <BaseNavigator
          bases={knowledgeBases}
          width={navigatorWidth}
          selectedBaseId={selectedBase.id}
          onSelectBase={setSelectedBaseId}
          onCreateBase={() => undefined}
          onResizeStart={startNavigatorResize}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <DetailHeader base={selectedBase} />
          <DetailTabs activeTab={activeTab} dataSourceCount={selectedBase.itemCount} onChange={setActiveTab} />

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTab === 'dataSource' && <DataSourcePanel />}
            {activeTab === 'ragConfig' && <RagConfigPanel />}
            {activeTab === 'recallTest' && <RecallTestPanel />}
          </div>
        </main>
      </div>
    </div>
  )
}

export default KnowledgeV2Page

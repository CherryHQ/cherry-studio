import type { KnowledgeBase } from '@renderer/types'
import type { KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import { Book, Folder, Globe, Link, Notebook } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeDirectories from '../items/KnowledgeDirectories'
import KnowledgeFiles from '../items/KnowledgeFiles'
import KnowledgeNotes from '../items/KnowledgeNotes'
import KnowledgeSitemaps from '../items/KnowledgeSitemaps'
import KnowledgeUrls from '../items/KnowledgeUrls'
import { groupKnowledgeItemsByType } from '../utils/knowledgeItems'

interface UseKnowledgeTabsArgs {
  base: KnowledgeBase | null
  items: KnowledgeItemV2[]
  progressMap: Map<string, number>
  preprocessMap: Map<string, boolean>
}

export type TabKey = 'files' | 'notes' | 'directories' | 'urls' | 'sitemaps'

interface KnowledgeTabItem {
  key: TabKey
  title: string
  icon: ReactNode
  items: KnowledgeItemV2[]
  content: ReactNode
  show: boolean
  addButtonLabel: string
}

const buildTabIcon = (Icon: typeof Book, isActive: boolean) => {
  return <Icon size={16} color={isActive ? 'var(--color-primary)' : undefined} />
}

export const useKnowledgeTabs = ({ base, items, progressMap, preprocessMap }: UseKnowledgeTabsArgs) => {
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = useState<TabKey>('files')

  const itemsByType = useMemo(() => groupKnowledgeItemsByType(items), [items])

  const tabItems = useMemo<KnowledgeTabItem[]>(() => {
    if (!base) {
      return []
    }

    const knowledgeItems: KnowledgeTabItem[] = [
      {
        key: 'files',
        title: t('files.title'),
        icon: buildTabIcon(Book, activeKey === 'files'),
        items: itemsByType.files,
        content: <KnowledgeFiles selectedBase={base} progressMap={progressMap} preprocessMap={preprocessMap} />,
        show: true,
        addButtonLabel: t('knowledge.add_file')
      },
      {
        key: 'notes',
        title: t('knowledge.notes'),
        icon: buildTabIcon(Notebook, activeKey === 'notes'),
        items: itemsByType.notes,
        content: <KnowledgeNotes selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_note')
      },
      {
        key: 'directories',
        title: t('knowledge.directories'),
        icon: buildTabIcon(Folder, activeKey === 'directories'),
        items: itemsByType.directories,
        content: <KnowledgeDirectories selectedBase={base} progressMap={progressMap} />,
        show: true,
        addButtonLabel: t('knowledge.add_directory')
      },
      {
        key: 'urls',
        title: t('knowledge.urls'),
        icon: buildTabIcon(Link, activeKey === 'urls'),
        items: itemsByType.urls,
        content: <KnowledgeUrls selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_url')
      },
      {
        key: 'sitemaps',
        title: t('knowledge.sitemaps'),
        icon: buildTabIcon(Globe, activeKey === 'sitemaps'),
        items: itemsByType.sitemaps,
        content: <KnowledgeSitemaps selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_sitemap')
      }
    ]

    return knowledgeItems.filter((item) => item.show)
  }, [activeKey, base, itemsByType, preprocessMap, progressMap, t])

  return { activeKey, setActiveKey, tabItems }
}

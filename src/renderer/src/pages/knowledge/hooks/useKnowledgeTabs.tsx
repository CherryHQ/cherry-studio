import { cn } from '@cherrystudio/ui/lib/utils'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
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
  items: KnowledgeItem[]
}

export type TabKey = 'files' | 'notes' | 'directories' | 'urls' | 'sitemaps'

interface KnowledgeTabItem {
  key: TabKey
  title: string
  icon: ReactNode
  items: KnowledgeItem[]
  content: ReactNode
  show: boolean
  addButtonLabel: string
}

export const useKnowledgeTabs = ({ base, items }: UseKnowledgeTabsArgs) => {
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
        icon: <Book size={16} className={cn(activeKey === 'files' ? 'text-primary' : undefined)} />,
        items: itemsByType.files,
        content: <KnowledgeFiles selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_file')
      },
      {
        key: 'notes',
        title: t('knowledge.notes'),
        icon: <Notebook size={16} className={cn(activeKey === 'notes' ? 'text-primary' : undefined)} />,
        items: itemsByType.notes,
        content: <KnowledgeNotes selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_note')
      },
      {
        key: 'directories',
        title: t('knowledge.directories'),
        icon: <Folder size={16} className={cn(activeKey === 'directories' ? 'text-primary' : undefined)} />,
        items: itemsByType.directories,
        content: <KnowledgeDirectories selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_directory')
      },
      {
        key: 'urls',
        title: t('knowledge.urls'),
        icon: <Link size={16} className={cn(activeKey === 'urls' ? 'text-primary' : undefined)} />,
        items: itemsByType.urls,
        content: <KnowledgeUrls selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_url')
      },
      {
        key: 'sitemaps',
        title: t('knowledge.sitemaps'),
        icon: <Globe size={16} className={cn(activeKey === 'sitemaps' ? 'text-primary' : undefined)} />,
        items: itemsByType.sitemaps,
        content: <KnowledgeSitemaps selectedBase={base} />,
        show: true,
        addButtonLabel: t('knowledge.add_sitemap')
      }
    ]

    return knowledgeItems.filter((item) => item.show)
  }, [activeKey, base, itemsByType, t])

  return { activeKey, setActiveKey, tabItems }
}

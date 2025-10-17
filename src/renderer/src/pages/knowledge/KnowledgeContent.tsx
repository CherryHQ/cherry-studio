import { Badge, Button, RowFlex, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { NavbarIcon } from '@renderer/pages/home/ChatNavbar'
import type { KnowledgeBase } from '@renderer/types'
import { t } from 'i18next'
import { Book, Folder, Globe, Link, Notebook, RotateCw, Search, Settings, Video } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import EditKnowledgeBasePopup from './components/EditKnowledgeBasePopup'
import KnowledgeSearchPopup from './components/KnowledgeSearchPopup'
import QuotaTag from './components/QuotaTag'
import KnowledgeDirectories from './items/KnowledgeDirectories'
import KnowledgeFiles from './items/KnowledgeFiles'
import KnowledgeNotes from './items/KnowledgeNotes'
import KnowledgeSitemaps from './items/KnowledgeSitemaps'
import KnowledgeUrls from './items/KnowledgeUrls'
import KnowledgeVideos from './items/KnowledgeVideos'

const logger = loggerService.withContext('KnowledgeContent')
interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()
  const { base, urlItems, fileItems, directoryItems, noteItems, sitemapItems, videoItems } = useKnowledge(
    selectedBase.id || ''
  )
  const [activeKey, setActiveKey] = useState('files')
  const [quota, setQuota] = useState<number | undefined>(undefined)
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map())
  const [preprocessMap, setPreprocessMap] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    const handlers = [
      window.electron.ipcRenderer.on('file-preprocess-finished', (_, { itemId, quota }) => {
        setPreprocessMap((prev) => new Map(prev).set(itemId, true))
        if (quota) {
          setQuota(quota)
        }
      }),

      window.electron.ipcRenderer.on('file-preprocess-progress', (_, { itemId, progress }) => {
        setProgressMap((prev) => new Map(prev).set(itemId, progress))
      }),

      window.electron.ipcRenderer.on('file-ocr-progress', (_, { itemId, progress }) => {
        setProgressMap((prev) => new Map(prev).set(itemId, progress))
      }),

      window.electron.ipcRenderer.on('directory-processing-percent', (_, { itemId, percent }) => {
        logger.debug('[Progress] Directory:', itemId, percent)
        setProgressMap((prev) => new Map(prev).set(itemId, percent))
      })
    ]

    return () => {
      handlers.forEach((cleanup) => cleanup())
    }
  }, [])
  const knowledgeItems = [
    {
      key: 'files',
      title: t('files.title'),
      icon: activeKey === 'files' ? <Book size={16} color="var(--color-primary)" /> : <Book size={16} />,
      items: fileItems,
      content: <KnowledgeFiles selectedBase={selectedBase} progressMap={progressMap} preprocessMap={preprocessMap} />,
      show: true
    },

    {
      key: 'notes',
      title: t('knowledge.notes'),
      icon: activeKey === 'notes' ? <Notebook size={16} color="var(--color-primary)" /> : <Notebook size={16} />,
      items: noteItems,
      content: <KnowledgeNotes selectedBase={selectedBase} />,
      show: true
    },
    {
      key: 'directories',
      title: t('knowledge.directories'),
      icon: activeKey === 'directories' ? <Folder size={16} color="var(--color-primary)" /> : <Folder size={16} />,
      items: directoryItems,
      content: <KnowledgeDirectories selectedBase={selectedBase} progressMap={progressMap} />,
      show: true
    },
    {
      key: 'urls',
      title: t('knowledge.urls'),
      icon: activeKey === 'urls' ? <Link size={16} color="var(--color-primary)" /> : <Link size={16} />,
      items: urlItems,
      content: <KnowledgeUrls selectedBase={selectedBase} />,
      show: true
    },
    {
      key: 'sitemaps',
      title: t('knowledge.sitemaps'),
      icon: activeKey === 'sitemaps' ? <Globe size={16} color="var(--color-primary)" /> : <Globe size={16} />,
      items: sitemapItems,
      content: <KnowledgeSitemaps selectedBase={selectedBase} />,
      show: true
    },
    // 暂时不显示，后续实现
    {
      key: 'videos',
      title: t('knowledge.videos'),
      icon: activeKey === 'videos' ? <Video size={16} color="var(--color-primary)" /> : <Video size={16} />,
      items: videoItems,
      content: <KnowledgeVideos selectedBase={selectedBase} />,
      show: false
    }
  ]

  if (!base) {
    return null
  }

  const visibleKnowledgeItems = knowledgeItems.filter((item) => item.show)

  return (
    <div className="relative flex w-full flex-col">
      <div className="flex items-center justify-between gap-2 border-[var(--color-border)] border-b-[0.5px] px-4">
        <div className="flex h-[45px] flex-row items-center gap-2 text-[var(--color-text-3)]">
          <Button
            variant="light"
            startContent={<Settings size={18} color="var(--color-icon)" />}
            isIconOnly
            onPress={() => EditKnowledgeBasePopup.show({ base })}
            size="sm"
          />
          <div className="flex items-start gap-2.5">
            <Badge variant="outline" className="rounded-md text-xs">
              {base.model.name}
            </Badge>

            {base.rerankModel && (
              <Badge variant="outline" className="rounded-md text-xs">
                {base.rerankModel.name}
              </Badge>
            )}
            {base.preprocessProvider && base.preprocessProvider.type === 'preprocess' && (
              <QuotaTag base={base} providerId={base.preprocessProvider?.provider.id} quota={quota} />
            )}
          </div>
        </div>
        <RowFlex className="items-center gap-2">
          {/* 使用selected base导致修改设置后没有响应式更新 */}
          <NavbarIcon onClick={() => base && KnowledgeSearchPopup.show({ base: base })}>
            <Search size={18} />
          </NavbarIcon>
        </RowFlex>
      </div>
      <Tabs value={activeKey} onValueChange={setActiveKey} className="flex-1">
        <TabsList className="ml-4 h-auto w-auto justify-start bg-transparent p-0">
          {visibleKnowledgeItems.map((item) => (
            <TabsTrigger
              key={item.key}
              value={item.key}
              className="flex h-auto flex-none items-center gap-1.5 px-3 py-1.5 text-[13px]">
              {item.icon}
              <span>{item.title}</span>
              <CustomTag size={10} color={item.items.length > 0 ? '#00b96b' : '#cccccc'}>
                {item.items.length}
              </CustomTag>
            </TabsTrigger>
          ))}
        </TabsList>
        {visibleKnowledgeItems.map((item) => (
          <TabsContent key={item.key} value={item.key} className="flex-1">
            {item.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

export const KnowledgeEmptyView = () => (
  <div className="w-full items-center justify-center text-center text-gray-400">{t('knowledge.empty_item')}</div>
)

export const ItemHeaderLabel = ({ label }: { label: string }) => {
  return (
    <RowFlex className="items-center gap-2.5">
      <label className="font-semibold">{label}</label>
    </RowFlex>
  )
}

export const ItemContainer: FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => {
  return <div className={`flex h-full flex-1 flex-col gap-2.5 ${className}`}>{children}</div>
}

export const ItemHeader: FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => {
  return (
    <div
      className={`item-header absolute right-4 z-[1000] flex flex-row items-center justify-between ${className}`}
      style={{
        top: 'calc(var(--navbar-height) + 12px)'
      }}>
      {children}
      <style>{`
        [navbar-position='top'] .item-header {
          top: calc(var(--navbar-height) + 10px);
        }
      `}</style>
    </div>
  )
}

export const StatusIconWrapper: FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = ''
}) => {
  return <div className={`flex h-9 w-9 items-center justify-center ${className}`}>{children}</div>
}

export const RefreshIcon: FC<{ className?: string; onClick?: () => void }> = ({ className = '', onClick }) => {
  return <RotateCw size={15} className={`text-[var(--color-text-2)] ${className}`} onClick={onClick} />
}

export const ClickableSpan: FC<{ children: React.ReactNode; onClick?: () => void; className?: string }> = ({
  children,
  onClick,
  className = ''
}) => {
  return (
    <span className={`w-0 flex-1 cursor-pointer ${className}`} onClick={onClick}>
      {children}
    </span>
  )
}

export const FlexAlignCenter: FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = ''
}) => {
  return <div className={`flex items-center justify-center ${className}`}>{children}</div>
}

export const ResponsiveButton: FC<React.ComponentProps<typeof Button>> = (props) => {
  return (
    <>
      <Button {...props} className={`responsive-button ${props.className || ''}`} />
      <style>{`
        @media (max-width: 1080px) {
          .responsive-button [data-slot="icon"] + [data-slot="label"] {
            display: none;
          }
        }
      `}</style>
    </>
  )
}

export default KnowledgeContent

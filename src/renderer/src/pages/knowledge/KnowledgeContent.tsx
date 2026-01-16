import { Badge, Button, RowFlex, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeBase, useKnowledgeItems, useKnowledgeQueueStatus } from '@renderer/data/hooks/useKnowledges'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { NavbarIcon } from '@renderer/pages/home/ChatNavbar'
import { getProviderName } from '@renderer/services/ProviderService'
import { Empty } from 'antd'
import { Book, Folder, Globe, Link, Notebook, RefreshCw, RotateCw, Search, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import EditKnowledgeBasePopup from './components/EditKnowledgeBasePopup'
import KnowledgeSearchPopup from './components/KnowledgeSearchPopup'
import QuotaTag from './components/QuotaTag'
import KnowledgeDirectories from './items/KnowledgeDirectories'
import KnowledgeFiles from './items/KnowledgeFiles'
import KnowledgeNotes from './items/KnowledgeNotes'
import KnowledgeSitemaps from './items/KnowledgeSitemaps'
import KnowledgeUrls from './items/KnowledgeUrls'
import { mapKnowledgeBaseV2ToV1 } from './utils/knowledgeBaseAdapter'

const logger = loggerService.withContext('KnowledgeContent')
interface KnowledgeContentProps {
  selectedBaseId: string
}

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBaseId }) => {
  const { t } = useTranslation()
  const { base: baseV2 } = useKnowledgeBase(selectedBaseId, { enabled: !!selectedBaseId })
  const { items } = useKnowledgeItems(selectedBaseId, { enabled: !!selectedBaseId })
  const { preprocessProviders } = usePreprocessProviders()
  const base = useMemo(
    () => (baseV2 ? mapKnowledgeBaseV2ToV1(baseV2, preprocessProviders) : undefined),
    [baseV2, preprocessProviders]
  )
  const [activeKey, setActiveKey] = useState('files')
  const [quota, setQuota] = useState<number | undefined>(undefined)
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map())
  const [preprocessMap, setPreprocessMap] = useState<Map<string, boolean>>(new Map())

  const providerName = getProviderName(base?.model)

  const fileItems = useMemo(() => items.filter((item) => item.type === 'file'), [items])
  const noteItems = useMemo(() => items.filter((item) => item.type === 'note'), [items])
  const directoryItems = useMemo(() => items.filter((item) => item.type === 'directory'), [items])
  const urlItems = useMemo(() => items.filter((item) => item.type === 'url'), [items])
  const sitemapItems = useMemo(() => items.filter((item) => item.type === 'sitemap'), [items])

  const handleMigrateV2 = useCallback(async () => {
    if (!base || base.version !== 1) return
    try {
      const result = await window.api.knowledgeBase.migrateV2(base)
      if (result.success) {
        window.toast.success(t('knowledge.migrate_v2_success'))
      } else {
        window.toast.error(result.error || t('knowledge.migrate_v2_failed'))
      }
    } catch (error) {
      window.toast.error(t('knowledge.migrate_v2_failed'))
      logger.error('Migration failed:', error as Error)
    }
  }, [base, t])

  // Queue status for orphan task detection
  const {
    hasOrphans,
    orphanCount,
    refetch: refetchQueue
  } = useKnowledgeQueueStatus(selectedBaseId, {
    enabled: !!selectedBaseId
  })

  const { trigger: recoverOrphans, isLoading: isRecovering } = useMutation(
    'POST',
    `/knowledge-bases/${selectedBaseId}/queue/recover`,
    {
      refresh: [`/knowledge-bases/${selectedBaseId}/items`]
    }
  )

  const { trigger: ignoreOrphans, isLoading: isIgnoring } = useMutation(
    'POST',
    `/knowledge-bases/${selectedBaseId}/queue/ignore`,
    {
      refresh: [`/knowledge-bases/${selectedBaseId}/items`]
    }
  )

  const handleRecover = useCallback(async () => {
    try {
      const result = await recoverOrphans({})
      await refetchQueue()
      window.toast.success(t('knowledge.orphan_recovered', { count: result.recoveredCount }))
    } catch (error) {
      window.toast.error(t('knowledge.orphan_recover_failed'))
      logger.error('Recover orphans failed:', error as Error)
    }
  }, [recoverOrphans, refetchQueue, t])

  const handleIgnore = useCallback(async () => {
    try {
      const result = await ignoreOrphans({})
      await refetchQueue()
      window.toast.info(t('knowledge.orphan_ignored', { count: result.ignoredCount }))
    } catch (error) {
      window.toast.error(t('knowledge.orphan_ignore_failed'))
      logger.error('Ignore orphans failed:', error as Error)
    }
  }, [ignoreOrphans, refetchQueue, t])

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
  if (!base) {
    return null
  }

  const knowledgeItems = [
    {
      key: 'files',
      title: t('files.title'),
      icon: activeKey === 'files' ? <Book size={16} color="var(--color-primary)" /> : <Book size={16} />,
      items: fileItems,
      content: <KnowledgeFiles selectedBase={base} progressMap={progressMap} preprocessMap={preprocessMap} />,
      show: true
    },

    {
      key: 'notes',
      title: t('knowledge.notes'),
      icon: activeKey === 'notes' ? <Notebook size={16} color="var(--color-primary)" /> : <Notebook size={16} />,
      items: noteItems,
      content: <KnowledgeNotes selectedBase={base} />,
      show: true
    },
    {
      key: 'directories',
      title: t('knowledge.directories'),
      icon: activeKey === 'directories' ? <Folder size={16} color="var(--color-primary)" /> : <Folder size={16} />,
      items: directoryItems,
      content: <KnowledgeDirectories selectedBase={base} progressMap={progressMap} />,
      show: true
    },
    {
      key: 'urls',
      title: t('knowledge.urls'),
      icon: activeKey === 'urls' ? <Link size={16} color="var(--color-primary)" /> : <Link size={16} />,
      items: urlItems,
      content: <KnowledgeUrls selectedBase={base} />,
      show: true
    },
    {
      key: 'sitemaps',
      title: t('knowledge.sitemaps'),
      icon: activeKey === 'sitemaps' ? <Globe size={16} color="var(--color-primary)" /> : <Globe size={16} />,
      items: sitemapItems,
      content: <KnowledgeSitemaps selectedBase={base} />,
      show: true
    }
  ]

  const tabItems = knowledgeItems.filter((item) => item.show)

  return (
    <MainContainer>
      <HeaderContainer>
        <ModelInfo>
          <Button variant="ghost" size="icon-sm" onClick={() => EditKnowledgeBasePopup.show({ baseId: base.id })}>
            <Settings size={18} color="var(--color-icon)" />
          </Button>
          <div className="model-row">
            <div className="label-column">
              <label>{t('models.embedding_model')}</label>
            </div>
            <Tooltip placement="bottom" content={providerName}>
              <div className="tag-column">
                <Badge>{base.model.name}</Badge>
              </div>
            </Tooltip>
            {base.rerankModel && <Badge>{base.rerankModel.name}</Badge>}
            {base.preprocessProvider && base.preprocessProvider.type === 'preprocess' && (
              <QuotaTag base={base} providerId={base.preprocessProvider?.provider.id} quota={quota} />
            )}
          </div>
        </ModelInfo>
        <RowFlex className="items-center gap-2">
          {hasOrphans && (
            <>
              <Button variant="outline" size="sm" onClick={handleRecover} disabled={isRecovering || isIgnoring}>
                <RefreshCw size={14} className={isRecovering ? 'animate-spin' : ''} />
                {t('knowledge.recover_orphans', { count: orphanCount })}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleIgnore} disabled={isRecovering || isIgnoring}>
                {t('knowledge.ignore_orphans')}
              </Button>
            </>
          )}
          {base.version === 1 && (
            <Button variant="outline" size="sm" onClick={handleMigrateV2}>
              <RefreshCw size={14} />
              {t('knowledge.migrate_v2')}
            </Button>
          )}
          {/* 使用selected base导致修改设置后没有响应式更新 */}
          <NavbarIcon onClick={() => base && KnowledgeSearchPopup.show({ baseId: base.id })}>
            <Search size={18} />
          </NavbarIcon>
        </RowFlex>
      </HeaderContainer>
      <Tabs value={activeKey} onValueChange={setActiveKey} variant="line" className="flex-1">
        <TabsList className="mx-4 h-12 justify-start gap-1 border-b-0 bg-transparent p-0">
          {tabItems.map((item) => (
            <TabsTrigger key={item.key} value={item.key} className="gap-1.5 px-3 py-3 text-[13px]">
              {item.icon}
              <span>{item.title}</span>
              <CustomTag size={10} color={item.items.length > 0 ? '#00b96b' : '#cccccc'}>
                {item.items.length}
              </CustomTag>
            </TabsTrigger>
          ))}
        </TabsList>
        {tabItems.map((item) => (
          <TabsContent key={item.key} value={item.key} className="h-full overflow-hidden">
            {item.content}
          </TabsContent>
        ))}
      </Tabs>
    </MainContainer>
  )
}

export const KnowledgeEmptyView = () => <Empty style={{ margin: 20 }} styles={{ image: { display: 'none' } }} />

export const ItemHeaderLabel = ({ label }: { label: string }) => {
  return (
    <RowFlex className="items-center gap-2.5">
      <label style={{ fontWeight: 600 }}>{label}</label>
    </RowFlex>
  )
}

const MainContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  position: relative;
`

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 0.5px solid var(--color-border);
`

const ModelInfo = styled.div`
  display: flex;
  color: var(--color-text-3);
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 45px;

  .model-header {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .model-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .label-column {
    flex-shrink: 0;
  }

  .tag-column {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  label {
    color: var(--color-text-2);
  }
`

export const ItemContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  flex: 1;
`

export const ItemHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  position: absolute;
  right: 16px;
  z-index: 1000;
  top: calc(var(--navbar-height) + 12px);
  [navbar-position='top'] & {
    top: calc(var(--navbar-height) + 10px);
  }
`

export const StatusIconWrapper = styled.div`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
`

export const RefreshIcon = () => <RotateCw size={15} className="text-muted-foreground" />

export const ClickableSpan = styled.span`
  cursor: pointer;
  flex: 1;
  width: 0;
`

export const FlexAlignCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

export const ResponsiveButton = styled(Button)`
  @media (max-width: 1080px) {
    [data-slot="icon"] + [data-slot="label"] {
      display: none;
    }
  }
`

export default KnowledgeContent

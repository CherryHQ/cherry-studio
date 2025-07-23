import { RedoOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import CustomTag from '@renderer/components/CustomTag'
import { HStack } from '@renderer/components/Layout'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { NavbarIcon } from '@renderer/pages/home/ChatNavbar'
import { getProviderName } from '@renderer/services/ProviderService'
import { KnowledgeBase } from '@renderer/types'
import { Button, Empty, Tabs, Tag, Tooltip } from 'antd'
import { Book, Folder, Globe, Link, Notebook, Search, Settings } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import KnowledgeSearchPopup from './components/KnowledgeSearchPopup'
import KnowledgeSettings from './components/KnowledgeSettings'
import QuotaTag from './components/QuotaTag'
import KnowledgeDirectories from './items/KnowledgeDirectories'
import KnowledgeFiles from './items/KnowledgeFiles'
import KnowledgeNotes from './items/KnowledgeNotes'
import KnowledgeSitemaps from './items/KnowledgeSitemaps'
import KnowledgeUrls from './items/KnowledgeUrls'

const logger = loggerService.withContext('KnowledgeContent')
interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()
  const { base, urlItems, fileItems, directoryItems, noteItems, sitemapItems } = useKnowledge(selectedBase.id || '')
  const [activeKey, setActiveKey] = useState('files')
  const [quota, setQuota] = useState<number | undefined>(undefined)
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map())
  const [preprocessMap, setPreprocessMap] = useState<Map<string, boolean>>(new Map())

  const providerName = getProviderName(base?.model.provider || '')

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
      content: <KnowledgeFiles selectedBase={selectedBase} progressMap={progressMap} preprocessMap={preprocessMap} />
    },
    {
      key: 'notes',
      title: t('knowledge.notes'),
      icon: activeKey === 'notes' ? <Notebook size={16} color="var(--color-primary)" /> : <Notebook size={16} />,
      items: noteItems,
      content: <KnowledgeNotes selectedBase={selectedBase} />
    },
    {
      key: 'directories',
      title: t('knowledge.directories'),
      icon: activeKey === 'directories' ? <Folder size={16} color="var(--color-primary)" /> : <Folder size={16} />,
      items: directoryItems,
      content: <KnowledgeDirectories selectedBase={selectedBase} progressMap={progressMap} />
    },
    {
      key: 'urls',
      title: t('knowledge.urls'),
      icon: activeKey === 'urls' ? <Link size={16} color="var(--color-primary)" /> : <Link size={16} />,
      items: urlItems,
      content: <KnowledgeUrls selectedBase={selectedBase} />
    },
    {
      key: 'sitemaps',
      title: t('knowledge.sitemaps'),
      icon: activeKey === 'sitemaps' ? <Globe size={16} color="var(--color-primary)" /> : <Globe size={16} />,
      items: sitemapItems,
      content: <KnowledgeSitemaps selectedBase={selectedBase} />
    }
  ]

  if (!base) {
    return null
  }

  const tabItems = knowledgeItems.map((item) => ({
    key: item.key,
    label: (
      <TabLabel>
        {item.icon}
        <span>{item.title}</span>
        <CustomTag size={10} color={item.items.length > 0 ? '#00b96b' : '#cccccc'}>
          {item.items.length}
        </CustomTag>
      </TabLabel>
    ),
    children: <TabContent>{item.content}</TabContent>
  }))

  return (
    <MainContainer>
      <HeaderContainer>
        <ModelInfo>
          <Button
            type="text"
            icon={<Settings size={18} color="var(--color-icon)" />}
            onClick={() => KnowledgeSettings.show({ base })}
            size="small"
          />
          <div className="model-row">
            <div className="label-column">
              <label>{t('models.embedding_model')}</label>
            </div>
            <Tooltip title={providerName} placement="bottom">
              <div className="tag-column">
                <Tag style={{ borderRadius: 20, margin: 0 }}>{base.model.name}</Tag>
              </div>
            </Tooltip>
            {base.rerankModel && <Tag style={{ borderRadius: 20, margin: 0 }}>{base.rerankModel.name}</Tag>}
            {base.preprocessOrOcrProvider && base.preprocessOrOcrProvider.type === 'preprocess' && (
              <QuotaTag base={base} providerId={base.preprocessOrOcrProvider?.provider.id} quota={quota} />
            )}
          </div>
        </ModelInfo>
        <HStack gap={8} alignItems="center">
          {/* 使用selected base导致修改设置后没有响应式更新 */}
          <NarrowIcon onClick={() => base && KnowledgeSearchPopup.show({ base: base })}>
            <Search size={18} />
          </NarrowIcon>
        </HStack>
      </HeaderContainer>
      <StyledTabs activeKey={activeKey} onChange={setActiveKey} items={tabItems} type="line" size="small" />
    </MainContainer>
  )
}

export const KnowledgeEmptyView = () => <Empty style={{ margin: 20 }} styles={{ image: { display: 'none' } }} />

export const ItemHeaderLabel = ({ label }: { label: string }) => {
  return (
    <HStack alignItems="center" gap={10}>
      <label style={{ fontWeight: 600 }}>{label}</label>
    </HStack>
  )
}

const MainContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  position: relative;
`

const TabLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  font-size: 14px;
`

const TabContent = styled.div``

const StyledTabs = styled(Tabs)`
  flex: 1;

  .ant-tabs-nav {
    padding: 0 16px;
    margin: 0;
    min-height: 48px;
  }

  .ant-tabs-tab {
    padding: 12px 12px;
    margin-right: 0;
    font-size: 13px;

    &:hover {
      color: var(--color-primary);
    }
  }

  .ant-tabs-tab-btn {
    font-size: 13px;
  }

  .ant-tabs-content {
    position: initial !important;
  }

  .ant-tabs-content-holder {
    overflow: hidden;
  }

  .ant-tabs-tabpane {
    height: 100%;
    overflow: hidden;
  }

  .ant-tabs-ink-bar {
    height: 2px;
  }
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

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
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
  top: calc(var(--navbar-height) + 14px);
  right: 16px;
  z-index: 1000;
`

export const StatusIconWrapper = styled.div`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
`

export const RefreshIcon = styled(RedoOutlined)`
  font-size: 15px !important;
  color: var(--color-text-2);
`

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

export default KnowledgeContent

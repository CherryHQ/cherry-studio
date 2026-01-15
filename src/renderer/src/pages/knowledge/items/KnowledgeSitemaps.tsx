import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { DeleteIcon } from '@renderer/components/Icons'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useKnowledgeSitemaps } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import type { KnowledgeItem as KnowledgeItemV2, SitemapItemData } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import StatusIcon from '../components/StatusIcon'
import {
  ClickableSpan,
  FlexAlignCenter,
  ItemContainer,
  ItemHeader,
  KnowledgeEmptyView,
  RefreshIcon,
  ResponsiveButton,
  StatusIconWrapper
} from '../KnowledgeContent'

const logger = loggerService.withContext('KnowledgeSitemaps')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const getDisplayTime = (item: KnowledgeItemV2) => {
  const createdAt = Date.parse(item.createdAt)
  const updatedAt = Date.parse(item.updatedAt)
  const timestamp = updatedAt > createdAt ? updatedAt : createdAt
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeSitemaps: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  // v2 Data API hook for sitemap items
  const { sitemapItems, addSitemap, isAddingSitemap, deleteItem, refreshItem } = useKnowledgeSitemaps(
    selectedBase.id || ''
  )

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const reversedItems = [...sitemapItems].reverse()
  const estimateSize = useCallback(() => 75, [])

  if (!selectedBase) {
    return null
  }

  const handleAddSitemap = async () => {
    if (disabled || isAddingSitemap) {
      return
    }

    const url = await PromptPopup.show({
      title: t('knowledge.add_sitemap'),
      message: '',
      inputPlaceholder: t('knowledge.sitemap_placeholder'),
      inputProps: {
        maxLength: 1000,
        rows: 1
      }
    })

    if (url) {
      try {
        new URL(url)
        const hasUrl = sitemapItems.some((item) => (item.data as SitemapItemData).url === url)
        if (hasUrl) {
          window.toast.success(t('knowledge.sitemap_added'))
          return
        }
        addSitemap(url)
      } catch (e) {
        logger.error(`Invalid Sitemap URL: ${url}`)
      }
    }
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton variant="default" onClick={handleAddSitemap} disabled={disabled || isAddingSitemap}>
          <PlusIcon size={16} />
          {t('knowledge.add_sitemap')}
        </ResponsiveButton>
      </ItemHeader>
      <ItemFlexColumn>
        {sitemapItems.length === 0 && <KnowledgeEmptyView />}
        <DynamicVirtualList
          list={reversedItems}
          estimateSize={estimateSize}
          overscan={2}
          scrollerStyle={{ paddingRight: 2 }}
          itemContainerStyle={{ paddingBottom: 10 }}
          autoHideScrollbar>
          {(item) => {
            const data = item.data as SitemapItemData
            return (
              <FileItem
                key={item.id}
                fileInfo={{
                  name: (
                    <ClickableSpan>
                      <Tooltip content={data.url}>
                        <Ellipsis>
                          <a href={data.url} target="_blank" rel="noopener noreferrer">
                            {data.url}
                          </a>
                        </Ellipsis>
                      </Tooltip>
                    </ClickableSpan>
                  ),
                  ext: '.sitemap',
                  extra: getDisplayTime(item),
                  actions: (
                    <FlexAlignCenter>
                      {item.status === 'completed' && (
                        <Button variant="ghost" onClick={() => refreshItem(item.id)}>
                          <RefreshIcon />
                        </Button>
                      )}
                      <StatusIconWrapper>
                        <StatusIcon sourceId={item.id} item={item} type="sitemap" />
                      </StatusIconWrapper>
                      <Button variant="ghost" onClick={() => deleteItem(item.id)}>
                        <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                      </Button>
                    </FlexAlignCenter>
                  )
                }}
              />
            )
          }}
        </DynamicVirtualList>
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled.div`
  padding: 20px 16px;
  height: calc(100vh - 135px);
`

export default KnowledgeSitemaps

import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { DeleteIcon } from '@renderer/components/Icons'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import { KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { Button, message, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import { FC, useCallback, useMemo } from 'react'
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
  StatusIconWrapper
} from '../KnowledgeContent'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const logger = loggerService.withContext('KnowledgeSitemaps')

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeSitemaps: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  const { base, sitemapItems, refreshItem, addSitemap, removeItem, getProcessingStatus } = useKnowledge(
    selectedBase.id || ''
  )

  const providerName = getProviderName(base?.model.provider || '')
  const disabled = !base?.version || !providerName

  const reversedItems = useMemo(() => [...sitemapItems].reverse(), [sitemapItems])
  const estimateSize = useCallback(() => 75, [])

  if (!base) {
    return null
  }

  const handleAddSitemap = async () => {
    if (disabled) {
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
        if (sitemapItems.find((item) => item.content === url)) {
          message.success(t('knowledge.sitemap_added'))
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
        <Button
          type="primary"
          icon={<PlusIcon size={16} />}
          onClick={(e) => {
            e.stopPropagation()
            handleAddSitemap()
          }}
          disabled={disabled}>
          {t('knowledge.add_sitemap')}
        </Button>
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
          {(item) => (
            <FileItem
              key={item.id}
              fileInfo={{
                name: (
                  <ClickableSpan>
                    <Tooltip title={item.content as string}>
                      <Ellipsis>
                        <a href={item.content as string} target="_blank" rel="noopener noreferrer">
                          {item.content as string}
                        </a>
                      </Ellipsis>
                    </Tooltip>
                  </ClickableSpan>
                ),
                ext: '.sitemap',
                extra: getDisplayTime(item),
                actions: (
                  <FlexAlignCenter>
                    {item.uniqueId && <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />}
                    <StatusIconWrapper>
                      <StatusIcon
                        sourceId={item.id}
                        base={base}
                        getProcessingStatus={getProcessingStatus}
                        type="sitemap"
                      />
                    </StatusIconWrapper>
                    <Button
                      type="text"
                      danger
                      onClick={() => removeItem(item)}
                      icon={<DeleteIcon size={14} className="lucide-custom" />}
                    />
                  </FlexAlignCenter>
                )
              }}
            />
          )}
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

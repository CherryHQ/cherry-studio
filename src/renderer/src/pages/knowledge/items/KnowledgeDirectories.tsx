import { DeleteOutlined } from '@ant-design/icons'
import Ellipsis from '@renderer/components/Ellipsis'
import Scrollbar from '@renderer/components/Scrollbar'
import Logger from '@renderer/config/logger'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import { KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { Button, Modal, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { Plus } from 'lucide-react'
import { FC } from 'react'
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
  progressMap: Map<string, number>
}

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeDirectories: FC<KnowledgeContentProps> = ({ selectedBase, progressMap }) => {
  const { t } = useTranslation()

  const { base, directoryItems, refreshItem, removeItem, getProcessingStatus, addDirectory } = useKnowledge(
    selectedBase.id || ''
  )

  const providerName = getProviderName(base?.model.provider || '')
  const disabled = !base?.version || !providerName

  if (!base) {
    return null
  }

  const handleAddDirectory = async () => {
    if (disabled) {
      return
    }

    const path = await window.api.file.selectFolder()
    Logger.log('[KnowledgeContent] Selected directory:', path)
    path && addDirectory(path)
  }

  const handleDeleteDirectory = (item: KnowledgeItem) => {
    const fileCount = item.uniqueIds?.length || 0
    
    Modal.confirm({
      title: '确认删除目录',
      content: (
        <div>
          <p>你确定要删除目录 <strong>"{item.content as string}"</strong> 吗？</p>
          {fileCount > 0 && (
            <p style={{ color: '#ff4d4f' }}>
              此目录包含 <strong>{fileCount}</strong> 个文件，删除操作可能需要一些时间。
            </p>
          )}
          <p style={{ color: '#666' }}>此操作不可撤销。</p>
        </div>
      ),
      okText: '确认删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: () => removeItem(item),
      width: 400
    })
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          onClick={(e) => {
            e.stopPropagation()
            handleAddDirectory()
          }}
          disabled={disabled}>
          {t('knowledge.add_directory')}
        </Button>
      </ItemHeader>
      <ItemFlexColumn>
        {directoryItems.length === 0 && <KnowledgeEmptyView />}
        {directoryItems.reverse().map((item) => (
          <FileItem
            key={item.id}
            fileInfo={{
              name: (
                <ClickableSpan onClick={() => window.api.file.openPath(item.content as string)}>
                  <Ellipsis>
                    <Tooltip title={item.content as string}>{item.content as string}</Tooltip>
                  </Ellipsis>
                </ClickableSpan>
              ),
              ext: '.folder',
              extra: getDisplayTime(item),
              actions: (
                <FlexAlignCenter>
                  {item.uniqueId && <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />}
                  <StatusIconWrapper>
                    <StatusIcon
                      sourceId={item.id}
                      base={base}
                      getProcessingStatus={getProcessingStatus}
                      progress={progressMap.get(item.id)}
                      type="directory"
                    />
                  </StatusIconWrapper>
                  <Button 
                    type="text" 
                    danger 
                    onClick={() => handleDeleteDirectory(item)} 
                    icon={<DeleteOutlined />}
                    title={`删除目录（包含 ${item.uniqueIds?.length || 0} 个文件）`}
                  />
                </FlexAlignCenter>
              )
            }}
          />
        ))}
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 16px;
  height: calc(100vh - 135px);
`

export default KnowledgeDirectories

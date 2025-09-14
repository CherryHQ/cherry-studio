import { ExclamationCircleOutlined } from '@ant-design/icons'
import { DeleteIcon } from '@renderer/components/Icons'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { handleDelete } from '@renderer/services/FileAction'
import FileManager from '@renderer/services/FileManager'
import { FileMetadata, FileTypes } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Col, Image, Row, Spin } from 'antd'
import { t } from 'i18next'
import React, { memo, useCallback } from 'react'
import styled from 'styled-components'

import FileItem from './FileItem'

interface FileItemProps {
  id: FileTypes | 'all' | string
  list: {
    key: FileTypes | 'all' | string
    file: React.ReactNode
    files?: FileMetadata[]
    count?: number
    size: string
    ext: string
    created_at: string
    actions: React.ReactNode
  }[]
  files?: FileMetadata[]
}

const FileList: React.FC<FileItemProps> = ({ id, list, files }) => {
  const estimateSize = useCallback(() => 75, [])

  if (id === FileTypes.IMAGE && files?.length && files?.length > 0) {
    return (
      <div style={{ padding: 16, overflowY: 'auto' }}>
        <Image.PreviewGroup>
          <Row gutter={[16, 16]}>
            {files?.map((file) => (
              <Col key={file.id} xs={24} sm={12} md={8} lg={4} xl={3}>
                <ImageWrapper>
                  <LoadingWrapper>
                    <Spin />
                  </LoadingWrapper>
                  <Image
                    src={FileManager.getFileUrl(file)}
                    style={{ height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                    preview={{ mask: false }}
                    onLoad={(e) => {
                      const img = e.target as HTMLImageElement
                      img.parentElement?.classList.add('loaded')
                    }}
                  />
                  <ImageInfo>
                    <div>{formatFileSize(file.size)}</div>
                  </ImageInfo>
                  <DeleteButton
                    title={t('files.delete.title')}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.modal.confirm({
                        title: t('files.delete.title'),
                        content: t('files.delete.content'),
                        okText: t('common.confirm'),
                        cancelText: t('common.cancel'),
                        centered: true,
                        onOk: () => {
                          handleDelete(file.id, t)
                        },
                        icon: <ExclamationCircleOutlined style={{ color: 'red' }} />
                      })
                    }}>
                    <DeleteIcon size={14} className="lucide-custom" />
                  </DeleteButton>
                </ImageWrapper>
              </Col>
            ))}
          </Row>
        </Image.PreviewGroup>
      </div>
    )
  }

  return (
    <DynamicVirtualList
      list={list}
      estimateSize={estimateSize}
      overscan={2}
      scrollerStyle={{
        padding: '0 16px 16px 16px'
      }}
      itemContainerStyle={{
        height: '75px',
        paddingTop: '12px'
      }}>
      {(item) => (
        <FileItem
          key={item.key}
          fileInfo={{
            name: item.file,
            ext: item.ext,
            extra: `${item.created_at} · ${item.count}${t('files.count')} · ${item.size}`,
            actions: item.actions
          }}
        />
      )}
    </DynamicVirtualList>
  )
}

const ImageWrapper = styled.div`
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 8px;
  background-color: var(--color-background-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0.5px solid var(--color-border);

  .ant-image {
    height: 100%;
    width: 100%;
    opacity: 0;
    transition:
      opacity 0.3s ease,
      transform 0.3s ease;

    &.loaded {
      opacity: 1;
    }
  }

  &:hover {
    .ant-image.loaded {
      transform: scale(1.05);
    }

    div:last-child {
      opacity: 1;
    }
  }
`

const LoadingWrapper = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-soft);
`

const ImageInfo = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 5px 8px;
  opacity: 0;
  transition: opacity 0.3s ease;
  font-size: 12px;

  > div:first-child {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const DeleteButton = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 1;

  &:hover {
    background-color: rgba(255, 0, 0, 0.8);
  }
`

export default memo(FileList)

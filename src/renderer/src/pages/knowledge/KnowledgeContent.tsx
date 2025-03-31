import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  SettingOutlined
} from '@ant-design/icons'
import Ellipsis from '@renderer/components/Ellipsis'
import { HStack } from '@renderer/components/Layout'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileManager from '@renderer/services/FileManager'
import { getProviderName } from '@renderer/services/ProviderService'
import { FileType, FileTypes, KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import { Alert, Button, Dropdown, Empty, message, Tag, Tooltip, Upload } from 'antd'
import dayjs from 'dayjs'
import VirtualList from 'rc-virtual-list'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CustomCollapse from '../../components/CustomCollapse'
import FileItem from '../files/FileItem'
import KnowledgeSearchPopup from './components/KnowledgeSearchPopup'
import KnowledgeSettingsPopup from './components/KnowledgeSettingsPopup'
import StatusIcon from './components/StatusIcon'

const { Dragger } = Upload

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  const {
    base,
    noteItems,
    fileItems,
    urlItems,
    sitemapItems,
    directoryItems,
    addFiles,
    updateNoteContent,
    refreshItem,
    addUrl,
    addSitemap,
    removeItem,
    getProcessingStatus,
    getDirectoryProcessingPercent,
    addNote,
    addDirectory,
    updateItem
  } = useKnowledge(selectedBase.id || '')

  const providerName = getProviderName(base?.model.provider || '')
  const rerankModelProviderName = getProviderName(base?.rerankModel?.provider || '')
  const disabled = !base?.version || !providerName

  if (!base) {
    return null
  }

  const getProgressingPercentForItem = (itemId: string) => getDirectoryProcessingPercent(itemId)

  const handleAddFile = () => {
    if (disabled) {
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = fileTypes.join(',')
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files
      files && handleDrop(Array.from(files))
    }
    input.click()
  }

  const handleDrop = async (files: File[]) => {
    if (disabled) {
      return
    }

    if (files) {
      const _files: FileType[] = files
        .map((file) => ({
          id: file.name,
          name: file.name,
          path: file.path,
          size: file.size,
          ext: `.${file.name.split('.').pop()}`.toLowerCase(),
          count: 1,
          origin_name: file.name,
          type: file.type as FileTypes,
          created_at: new Date().toISOString()
        }))
        .filter(({ ext }) => fileTypes.includes(ext))
      const uploadedFiles = await FileManager.uploadFiles(_files)
      addFiles(uploadedFiles)
    }
  }

  const handleAddUrl = async () => {
    if (disabled) {
      return
    }

    const urlInput = await PromptPopup.show({
      title: t('knowledge.add_url'),
      message: '',
      inputPlaceholder: t('knowledge.url_placeholder'),
      inputProps: {
        rows: 10,
        onPressEnter: () => {}
      }
    })

    if (urlInput) {
      // Split input by newlines and filter out empty lines
      const urls = urlInput.split('\n').filter((url) => url.trim())

      for (const url of urls) {
        try {
          new URL(url.trim())
          if (!urlItems.find((item) => item.content === url.trim())) {
            addUrl(url.trim())
          } else {
            message.success(t('knowledge.url_added'))
          }
        } catch (e) {
          // Skip invalid URLs silently
          continue
        }
      }
    }
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
        console.error('Invalid Sitemap URL:', url)
      }
    }
  }

  const handleAddNote = async () => {
    if (disabled) {
      return
    }

    const note = await TextEditPopup.show({ text: '', textareaProps: { rows: 20 } })
    note && addNote(note)
  }

  const handleEditNote = async (note: any) => {
    if (disabled) {
      return
    }

    const editedText = await TextEditPopup.show({ text: note.content as string, textareaProps: { rows: 20 } })
    editedText && updateNoteContent(note.id, editedText)
  }

  const handleAddDirectory = async () => {
    if (disabled) {
      return
    }

    const path = await window.api.file.selectFolder()
    console.log('[KnowledgeContent] Selected directory:', path)
    path && addDirectory(path)
  }

  const handleEditRemark = async (item: KnowledgeItem) => {
    if (disabled) {
      return
    }

    const editedRemark: string | undefined = await PromptPopup.show({
      title: t('knowledge.edit_remark'),
      message: '',
      inputPlaceholder: t('knowledge.edit_remark_placeholder'),
      defaultValue: item.remark || '',
      inputProps: {
        maxLength: 100,
        rows: 1
      }
    })

    if (editedRemark !== undefined && editedRemark !== null) {
      updateItem({
        ...item,
        remark: editedRemark,
        updated_at: Date.now()
      })
    }
  }

  return (
    <MainContent>
      {!base?.version && (
        <Alert message={t('knowledge.not_support')} type="error" style={{ marginBottom: 20 }} showIcon />
      )}
      {!providerName && (
        <Alert message={t('knowledge.no_provider')} type="error" style={{ marginBottom: 20 }} showIcon />
      )}

      <CustomCollapse
        label={<CollapseLabel label={t('files.title')} count={fileItems.length} />}
        extra={
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleAddFile()
            }}
            disabled={disabled}>
            {t('knowledge.add_file')}
          </Button>
        }>
        <Dragger
          showUploadList={false}
          customRequest={({ file }) => handleDrop([file as File])}
          multiple={true}
          accept={fileTypes.join(',')}
          style={{ marginTop: 10, background: 'transparent' }}>
          <p className="ant-upload-text">{t('knowledge.drag_file')}</p>
          <p className="ant-upload-hint">
            {t('knowledge.file_hint', { file_types: 'TXT, MD, HTML, PDF, DOCX, PPTX, XLSX, EPUB...' })}
          </p>
        </Dragger>

        <FlexColumn>
          {fileItems.length === 0 ? (
            <EmptyView />
          ) : (
            <VirtualList
              data={fileItems.reverse()}
              height={window.innerHeight - 310}
              itemHeight={80}
              itemKey="id"
              styles={{
                verticalScrollBar: {
                  width: 6
                },
                verticalScrollBarThumb: {
                  background: 'var(--color-scrollbar-thumb)'
                }
              }}>
              {(item) => {
                const file = item.content as FileType
                return (
                  <div style={{ height: '80px', paddingTop: '12px' }}>
                    <FileItem
                      key={item.id}
                      fileInfo={{
                        name: (
                          <ClickableSpan onClick={() => window.api.file.openPath(file.path)}>
                            <Ellipsis>
                              <Tooltip title={file.origin_name}>{file.origin_name}</Tooltip>
                            </Ellipsis>
                          </ClickableSpan>
                        ),
                        ext: file.ext,
                        extra: `${dayjs(file.created_at).format('MM-DD HH:mm')} · ${formatFileSize(file.size)}`,
                        actions: (
                          <FlexAlignCenter>
                            {item.uniqueId && (
                              <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />
                            )}
                            <StatusIconWrapper>
                              <StatusIcon
                                sourceId={item.id}
                                base={base}
                                getProcessingStatus={getProcessingStatus}
                                type="file"
                              />
                            </StatusIconWrapper>
                            <Button type="text" danger onClick={() => removeItem(item)} icon={<DeleteOutlined />} />
                          </FlexAlignCenter>
                        )
                      }}
                    />
                  </div>
                )
              }}
            </VirtualList>
          )}
        </FlexColumn>
      </CustomCollapse>

      <CustomCollapse
        label={<CollapseLabel label={t('knowledge.directories')} count={directoryItems.length} />}
        extra={
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleAddDirectory()
            }}
            disabled={disabled}>
            {t('knowledge.add_directory')}
          </Button>
        }>
        <FlexColumn>
          {directoryItems.length === 0 && <EmptyView />}
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
                extra: `${dayjs(item.created_at).format('MM-DD HH:mm')}`,
                actions: (
                  <FlexAlignCenter>
                    {item.uniqueId && <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />}
                    <StatusIconWrapper>
                      <StatusIcon
                        sourceId={item.id}
                        base={base}
                        getProcessingStatus={getProcessingStatus}
                        getProcessingPercent={getProgressingPercentForItem}
                        type="directory"
                      />
                    </StatusIconWrapper>
                    <Button type="text" danger onClick={() => removeItem(item)} icon={<DeleteOutlined />} />
                  </FlexAlignCenter>
                )
              }}
            />
          ))}
        </FlexColumn>
      </CustomCollapse>

      <CustomCollapse
        label={<CollapseLabel label={t('knowledge.urls')} count={urlItems.length} />}
        extra={
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleAddUrl()
            }}
            disabled={disabled}>
            {t('knowledge.add_url')}
          </Button>
        }>
        <FlexColumn>
          {urlItems.length === 0 && <EmptyView />}
          {urlItems.reverse().map((item) => (
            <FileItem
              key={item.id}
              fileInfo={{
                name: (
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: 'edit',
                          icon: <EditOutlined />,
                          label: t('knowledge.edit_remark'),
                          onClick: () => handleEditRemark(item)
                        },
                        {
                          key: 'copy',
                          icon: <CopyOutlined />,
                          label: t('common.copy'),
                          onClick: () => {
                            navigator.clipboard.writeText(item.content as string)
                            message.success(t('message.copied'))
                          }
                        }
                      ]
                    }}
                    trigger={['contextMenu']}>
                    <ClickableSpan>
                      <Tooltip title={item.content as string}>
                        <Ellipsis>
                          <a href={item.content as string} target="_blank" rel="noopener noreferrer">
                            {item.remark || (item.content as string)}
                          </a>
                        </Ellipsis>
                      </Tooltip>
                    </ClickableSpan>
                  </Dropdown>
                ),
                ext: '.url',
                extra: `${dayjs(item.created_at).format('MM-DD HH:mm')}`,
                actions: (
                  <FlexAlignCenter>
                    {item.uniqueId && <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />}
                    <StatusIconWrapper>
                      <StatusIcon sourceId={item.id} base={base} getProcessingStatus={getProcessingStatus} type="url" />
                    </StatusIconWrapper>
                    <Button type="text" danger onClick={() => removeItem(item)} icon={<DeleteOutlined />} />
                  </FlexAlignCenter>
                )
              }}
            />
          ))}
        </FlexColumn>
      </CustomCollapse>

      <CustomCollapse
        label={<CollapseLabel label={t('knowledge.sitemaps')} count={sitemapItems.length} />}
        extra={
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleAddSitemap()
            }}
            disabled={disabled}>
            {t('knowledge.add_sitemap')}
          </Button>
        }>
        <FlexColumn>
          {sitemapItems.length === 0 && <EmptyView />}
          {sitemapItems.reverse().map((item) => (
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
                extra: `${dayjs(item.created_at).format('MM-DD HH:mm')}`,
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
                    <Button type="text" danger onClick={() => removeItem(item)} icon={<DeleteOutlined />} />
                  </FlexAlignCenter>
                )
              }}
            />
          ))}
        </FlexColumn>
      </CustomCollapse>

      <CustomCollapse
        label={<CollapseLabel label={t('knowledge.notes')} count={noteItems.length} />}
        extra={
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleAddNote()
            }}
            disabled={disabled}>
            {t('knowledge.add_note')}
          </Button>
        }>
        <FlexColumn>
          {noteItems.length === 0 && <EmptyView />}
          {noteItems.reverse().map((note) => (
            <FileItem
              key={note.id}
              fileInfo={{
                name: <span onClick={() => handleEditNote(note)}>{(note.content as string).slice(0, 50)}...</span>,
                ext: '.txt',
                extra: `${dayjs(note.created_at).format('MM-DD HH:mm')}`,
                actions: (
                  <FlexAlignCenter>
                    <Button type="text" onClick={() => handleEditNote(note)} icon={<EditOutlined />} />
                    <StatusIconWrapper>
                      <StatusIcon
                        sourceId={note.id}
                        base={base}
                        getProcessingStatus={getProcessingStatus}
                        type="note"
                      />
                    </StatusIconWrapper>
                    <Button type="text" danger onClick={() => removeItem(note)} icon={<DeleteOutlined />} />
                  </FlexAlignCenter>
                )
              }}
            />
          ))}
        </FlexColumn>
      </CustomCollapse>
      <ModelInfo>
        <div className="model-header">
          <label>{t('knowledge.model_info')}</label>
          <Button icon={<SettingOutlined />} onClick={() => KnowledgeSettingsPopup.show({ base })} size="small" />
        </div>

        <div className="model-row">
          <div className="label-column">
            <label>{t('models.embedding_model')}</label>
          </div>
          <div className="tag-column">
            {providerName && <Tag color="purple">{providerName}</Tag>}
            <Tag color="blue">{base.model.name}</Tag>
            <Tag color="cyan">{t('models.dimensions', { dimensions: base.dimensions || 0 })}</Tag>
          </div>
        </div>

        {base.rerankModel && (
          <div className="model-row">
            <div className="label-column">
              <label>{t('models.rerank_model')}</label>
            </div>
            <div className="tag-column">
              {rerankModelProviderName && <Tag color="purple">{rerankModelProviderName}</Tag>}
              <Tag color="blue">{base.rerankModel?.name}</Tag>
            </div>
          </div>
        )}
      </ModelInfo>

      <IndexSection>
        <Button
          type="primary"
          onClick={() => KnowledgeSearchPopup.show({ base })}
          icon={<SearchOutlined />}
          disabled={disabled}>
          {t('knowledge.search')}
        </Button>
      </IndexSection>

      <BottomSpacer />
    </MainContent>
  )
}

const EmptyView = () => <Empty style={{ margin: 0 }} styles={{ image: { display: 'none' } }} />

const CollapseLabel = ({ label, count }: { label: string; count: number }) => {
  return (
    <HStack alignItems="center" gap={10}>
      <label>{label}</label>
      <Tag style={{ borderRadius: 100, padding: '0 10px' }} color={count ? 'green' : 'default'}>
        {count}
      </Tag>
    </HStack>
  )
}

const MainContent = styled(Scrollbar)`
  display: flex;
  width: 100%;
  flex-direction: column;
  padding-bottom: 50px;
  padding: 15px;
  position: relative;
  gap: 16px;
`

const IndexSection = styled.div`
  margin-top: 20px;
  display: flex;
  justify-content: center;
`

const ModelInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 5px;
  color: var(--color-text-3);

  .model-header {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 4px;
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

const FlexColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
`

const FlexAlignCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

const ClickableSpan = styled.span`
  cursor: pointer;
  flex: 1;
  width: 0;
`

const BottomSpacer = styled.div`
  min-height: 20px;
`

const StatusIconWrapper = styled.div`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 2px;
`

const RefreshIcon = styled(RedoOutlined)`
  font-size: 15px !important;
  color: var(--color-text-2);
`

export default KnowledgeContent

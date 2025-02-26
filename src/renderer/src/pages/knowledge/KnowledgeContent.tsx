import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOutlined,
  GlobalOutlined,
  LinkOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  SettingOutlined
} from '@ant-design/icons'
import Ellipsis from '@renderer/components/Ellipsis'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileManager from '@renderer/services/FileManager'
import { getProviderName } from '@renderer/services/ProviderService'
import { FileType, FileTypes, KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import { Alert, Button, Card, Divider, Dropdown, message, Tag, Tooltip, Typography, Upload } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import KnowledgeSearchPopup from './components/KnowledgeSearchPopup'
import KnowledgeSettingsPopup from './components/KnowledgeSettingsPopup'
import StatusIcon from './components/StatusIcon'

const { Dragger } = Upload
const { Title } = Typography

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
          ext: `.${file.name.split('.').pop()}`,
          count: 1,
          origin_name: file.name,
          type: file.type as FileTypes,
          created_at: new Date()
        }))
        .filter(({ ext }) => fileTypes.includes(ext))
      console.debug('[KnowledgeContent] Uploading files:', _files, files)
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
      <FileSection>
        <TitleWrapper>
          <Title level={5}>{t('files.title')}</Title>
          <Button icon={<PlusOutlined />} onClick={handleAddFile} disabled={disabled}>
            {t('knowledge.add_file')}
          </Button>
        </TitleWrapper>
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
      </FileSection>

      <FileListSection>
        {fileItems.reverse().map((item) => {
          const file = item.content as FileType
          return (
            <ItemCard key={item.id}>
              <ItemContent>
                <ItemInfo>
                  <FileIcon />
                  <ClickableSpan onClick={() => window.api.file.openPath(file.path)}>
                    <Tooltip title={file.origin_name}>
                      <Ellipsis text={file.origin_name} />
                    </Tooltip>
                  </ClickableSpan>
                </ItemInfo>
                <FlexAlignCenter>
                  {item.uniqueId && <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />}
                  <StatusIconWrapper>
                    <StatusIcon sourceId={item.id} base={base} getProcessingStatus={getProcessingStatus} type="file" />
                  </StatusIconWrapper>
                  <Button type="text" danger onClick={() => removeItem(item)} icon={<DeleteOutlined />} />
                </FlexAlignCenter>
              </ItemContent>
            </ItemCard>
          )
        })}
      </FileListSection>

      <ContentSection>
        <TitleWrapper>
          <Title level={5}>{t('knowledge.directories')}</Title>
          <Button icon={<PlusOutlined />} onClick={handleAddDirectory} disabled={disabled}>
            {t('knowledge.add_directory')}
          </Button>
        </TitleWrapper>
        <FlexColumn>
          {directoryItems.reverse().map((item) => (
            <ItemCard key={item.id}>
              <ItemContent>
                <ItemInfo>
                  <FolderOutlined />
                  <ClickableSpan onClick={() => window.api.file.openPath(item.content as string)}>
                    <Tooltip title={item.content as string}>
                      <Ellipsis text={item.content as string} />
                    </Tooltip>
                  </ClickableSpan>
                </ItemInfo>
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
              </ItemContent>
            </ItemCard>
          ))}
        </FlexColumn>
      </ContentSection>

      <ContentSection>
        <TitleWrapper>
          <Title level={5}>{t('knowledge.urls')}</Title>
          <Button icon={<PlusOutlined />} onClick={handleAddUrl} disabled={disabled}>
            {t('knowledge.add_url')}
          </Button>
        </TitleWrapper>
        <FlexColumn>
          {urlItems.reverse().map((item) => (
            <ItemCard key={item.id}>
              <ItemContent>
                <ItemInfo>
                  <LinkOutlined />
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
                    <a href={item.content as string} target="_blank" rel="noopener noreferrer">
                      <Tooltip title={item.content as string}>
                        <Ellipsis text={item.remark || (item.content as string)} />
                      </Tooltip>
                    </a>
                  </Dropdown>
                </ItemInfo>
                <FlexAlignCenter>
                  {item.uniqueId && <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />}
                  <StatusIconWrapper>
                    <StatusIcon sourceId={item.id} base={base} getProcessingStatus={getProcessingStatus} type="url" />
                  </StatusIconWrapper>
                  <Button type="text" danger onClick={() => removeItem(item)} icon={<DeleteOutlined />} />
                </FlexAlignCenter>
              </ItemContent>
            </ItemCard>
          ))}
        </FlexColumn>
      </ContentSection>

      <ContentSection>
        <TitleWrapper>
          <Title level={5}>{t('knowledge.sitemaps')}</Title>
          <Button icon={<PlusOutlined />} onClick={handleAddSitemap} disabled={disabled}>
            {t('knowledge.add_sitemap')}
          </Button>
        </TitleWrapper>
        <FlexColumn>
          {sitemapItems.reverse().map((item) => (
            <ItemCard key={item.id}>
              <ItemContent>
                <ItemInfo>
                  <GlobalOutlined />
                  <a href={item.content as string} target="_blank" rel="noopener noreferrer">
                    <Tooltip title={item.content as string}>
                      <Ellipsis text={item.content as string} />
                    </Tooltip>
                  </a>
                </ItemInfo>
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
              </ItemContent>
            </ItemCard>
          ))}
        </FlexColumn>
      </ContentSection>

      <ContentSection>
        <TitleWrapper>
          <Title level={5}>{t('knowledge.notes')}</Title>
          <Button icon={<PlusOutlined />} onClick={handleAddNote} disabled={disabled}>
            {t('knowledge.add_note')}
          </Button>
        </TitleWrapper>
        <FlexColumn>
          {noteItems.reverse().map((note) => (
            <ItemCard key={note.id}>
              <ItemContent>
                <ItemInfo onClick={() => handleEditNote(note)} style={{ cursor: 'pointer' }}>
                  <span>{(note.content as string).slice(0, 50)}...</span>
                </ItemInfo>
                <FlexAlignCenter>
                  <Button type="text" onClick={() => handleEditNote(note)} icon={<EditOutlined />} />
                  <StatusIconWrapper>
                    <StatusIcon sourceId={note.id} base={base} getProcessingStatus={getProcessingStatus} type="note" />
                  </StatusIconWrapper>
                  <Button type="text" danger onClick={() => removeItem(note)} icon={<DeleteOutlined />} />
                </FlexAlignCenter>
              </ItemContent>
            </ItemCard>
          ))}
        </FlexColumn>
      </ContentSection>

      <Divider style={{ margin: '10px 0' }} />

      <ModelInfo>
        <label htmlFor="model-info">{t('knowledge.model_info')}</label>
        <Tag color="blue">{base.model.name}</Tag>
        <Tag color="cyan">{t('models.dimensions', { dimensions: base.dimensions || 0 })}</Tag>
        {providerName && <Tag color="purple">{providerName}</Tag>}
        <Button icon={<SettingOutlined />} onClick={() => KnowledgeSettingsPopup.show({ base })} size="small" />
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

const MainContent = styled(Scrollbar)`
  display: flex;
  width: 100%;
  flex-direction: column;
  padding-bottom: 50px;
  padding: 15px;
  position: relative;
`

const FileSection = styled.div`
  display: flex;
  flex-direction: column;
`

const ContentSection = styled.div`
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  .ant-input-textarea {
    background: var(--color-background-soft);
    border-radius: 8px;
  }
`

const TitleWrapper = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
  background-color: var(--color-background-soft);
  padding: 5px 20px;
  min-height: 45px;
  border-radius: 6px;
  .ant-typography {
    margin-bottom: 0;
  }
`

const FileListSection = styled.div`
  margin-top: 20px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ItemCard = styled(Card)`
  background-color: transparent;
  border: none;
  .ant-card-body {
    padding: 0 20px;
  }
`

const ItemContent = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const ItemInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;

  a {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 600px;
  }
`

const IndexSection = styled.div`
  margin-top: 20px;
  display: flex;
  justify-content: center;
`

const ModelInfo = styled.div`
  display: flex;
  align-items: center;
  padding: 5px;
  color: var(--color-text-3);
  label {
    margin-right: 8px;
    color: var(--color-text-2);
  }
`

const FlexColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const FlexAlignCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

const ClickableSpan = styled.span`
  cursor: pointer;
`

const FileIcon = styled(FileTextOutlined)`
  font-size: 16px;
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

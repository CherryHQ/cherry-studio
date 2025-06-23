import { CopyOutlined, DeleteOutlined, EditOutlined, RedoOutlined } from '@ant-design/icons'
import CustomTag from '@renderer/components/CustomTag'
import Ellipsis from '@renderer/components/Ellipsis'
import { HStack } from '@renderer/components/Layout'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import Logger from '@renderer/config/logger'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { getProviderName } from '@renderer/services/ProviderService'
import { FileMetadata, FileTypes, KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { formatFileSize, uuid } from '@renderer/utils'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import { Alert, Button, Dropdown, Empty, message, Tag, Tooltip, Upload } from 'antd'
import dayjs from 'dayjs'
import { ChevronsDown, ChevronsUp, Plus, Search, Settings2 } from 'lucide-react'
import VirtualList from 'rc-virtual-list'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CustomCollapse from '../../components/CustomCollapse'
import FileItem from '../files/FileItem'
import { NavbarIcon } from '../home/Navbar'
import KnowledgeSearchPopup from './components/KnowledgeSearchPopup'
import KnowledgeSettings from './components/KnowledgeSettings'
import QuotaTag from './components/QuotaTag'
import StatusIcon from './components/StatusIcon'

const { Dragger } = Upload

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()
  const [expandAll, setExpandAll] = useState(false)
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map())
  const [preprocessMap, setPreprocessMap] = useState<Map<string, boolean>>(new Map())
  const [quota, setQuota] = useState<number | undefined>(undefined)

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
    addNote,
    addDirectory,
    updateItem
  } = useKnowledge(selectedBase.id || '')

  const providerName = getProviderName(base?.model.provider || '')
  const disabled = !base?.version || !providerName
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

      window.electron.ipcRenderer.on('directory-processing-percent', (_, { itemId, percent }) => {
        console.log('[Progress] Directory:', itemId, percent)
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
      const _files: FileMetadata[] = files
        .map((file) => {
          // 这个路径 filePath 很可能是在文件选择时的原始路径。
          const filePath = window.api.file.getPathForFile(file)
          let nameFromPath = filePath
          const lastSlash = filePath.lastIndexOf('/')
          const lastBackslash = filePath.lastIndexOf('\\')
          if (lastSlash !== -1 || lastBackslash !== -1) {
            nameFromPath = filePath.substring(Math.max(lastSlash, lastBackslash) + 1)
          }

          // 从派生的文件名中获取扩展名
          const extFromPath = nameFromPath.includes('.') ? `.${nameFromPath.split('.').pop()}` : ''

          return {
            id: uuid(),
            name: nameFromPath, // 使用从路径派生的文件名
            path: filePath,
            size: file.size,
            ext: extFromPath.toLowerCase(),
            count: 1,
            origin_name: file.name, // 保存 File 对象中原始的文件名
            type: file.type as FileTypes,
            created_at: new Date().toISOString()
          }
        })
        .filter(({ ext }) => fileTypes.includes(ext))
      // const uploadedFiles = await FileManager.uploadFiles(_files)
      addFiles(_files)
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
    Logger.log('[KnowledgeContent] Selected directory:', path)
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

  const showPreprocessIcon = (item: KnowledgeItem) => {
    if (base.preprocessOrOcrProvider && item.isPreprocessed !== false) {
      return true
    }
    if (!base.preprocessOrOcrProvider && item.isPreprocessed === true) {
      return true
    }
    return false
  }

  return (
    <MainContainer>
      <HeaderContainer>
        <ModelInfo>
          <Button
            type="text"
            icon={<Settings2 size={18} color="var(--color-icon)" />}
            onClick={() => KnowledgeSettings.show({ base })}
            size="small"
          />
          <div className="model-row">
            <div className="label-column">
              <label>{t('models.embedding_model')}</label>
            </div>
            <Tooltip title={providerName} placement="bottom">
              <div className="tag-column">
                <Tag color="green" style={{ borderRadius: 20, margin: 0 }}>
                  {base.model.name}
                </Tag>
              </div>
            </Tooltip>
            {base.rerankModel && (
              <Tag color="cyan" style={{ borderRadius: 20, margin: 0 }}>
                {base.rerankModel.name}
              </Tag>
            )}
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
          <Tooltip title={expandAll ? t('common.collapse') : t('common.expand')}>
            <Button
              size="small"
              shape="circle"
              onClick={() => setExpandAll(!expandAll)}
              icon={expandAll ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
              disabled={disabled}
            />
          </Tooltip>
        </HStack>
      </HeaderContainer>
      <MainContent>
        {!base?.version && (
          <Alert message={t('knowledge.not_support')} type="error" style={{ marginBottom: 20 }} showIcon />
        )}
        {!providerName && (
          <Alert message={t('knowledge.no_provider')} type="error" style={{ marginBottom: 20 }} showIcon />
        )}
        <CustomCollapse
          label={<CollapseLabel label={t('files.title')} count={fileItems.length} />}
          defaultActiveKey={['1']}
          activeKey={expandAll ? ['1'] : undefined}
          extra={
            <Button
              type="text"
              icon={<Plus size={16} />}
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
                height={fileItems.length > 5 ? 400 : fileItems.length * 75}
                itemHeight={75}
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
                  const file = item.content as FileMetadata
                  return (
                    <div style={{ height: '75px', paddingTop: '12px' }}>
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
                              {showPreprocessIcon(item) && (
                                <StatusIconWrapper>
                                  <StatusIcon
                                    sourceId={item.id}
                                    base={base}
                                    getProcessingStatus={getProcessingStatus}
                                    type="file"
                                    isPreprocessed={preprocessMap.get(item.id) || item.isPreprocessed || false}
                                    progress={progressMap.get(item.id)}
                                  />
                                </StatusIconWrapper>
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
          defaultActiveKey={[]}
          activeKey={expandAll ? ['1'] : undefined}
          extra={
            <Button
              type="text"
              icon={<Plus size={16} />}
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
          defaultActiveKey={[]}
          activeKey={expandAll ? ['1'] : undefined}
          extra={
            <Button
              type="text"
              icon={<Plus size={16} />}
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
                        <StatusIcon
                          sourceId={item.id}
                          base={base}
                          getProcessingStatus={getProcessingStatus}
                          type="url"
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
          label={<CollapseLabel label={t('knowledge.sitemaps')} count={sitemapItems.length} />}
          defaultActiveKey={[]}
          activeKey={expandAll ? ['1'] : undefined}
          extra={
            <Button
              type="text"
              icon={<Plus size={16} />}
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
          defaultActiveKey={[]}
          activeKey={expandAll ? ['1'] : undefined}
          extra={
            <Button
              type="text"
              icon={<Plus size={16} />}
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
      </MainContent>
    </MainContainer>
  )
}

const EmptyView = () => <Empty style={{ margin: 0 }} styles={{ image: { display: 'none' } }} />

const CollapseLabel = ({ label, count }: { label: string; count: number }) => {
  return (
    <HStack alignItems="center" gap={10}>
      <label style={{ fontWeight: 600 }}>{label}</label>
      <CustomTag size={12} color={count ? '#008001' : '#cccccc'}>
        {count}
      </CustomTag>
    </HStack>
  )
}

const MainContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  position: relative;
`

const MainContent = styled(Scrollbar)`
  padding: 15px 20px;
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 20px;
  padding-bottom: 50px;
  padding-right: 12px;
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
  height: 50px;

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

const StatusIconWrapper = styled.div`
  width: 32px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const RefreshIcon = styled(RedoOutlined)`
  font-size: 15px !important;
  color: var(--color-text-2);
`

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

export default KnowledgeContent

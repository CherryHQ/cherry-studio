import { loggerService } from '@logger'
import { ImportService } from '@renderer/services/import'
import { Alert, Checkbox, Modal, Progress, Radio, Space, Spin } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('ImportPopup')

type ImportSource = 'auto' | 'chatgpt' | 'claude'

interface PopupResult {
  success?: boolean
}

interface Props {
  resolve: (data: PopupResult) => void
  initialSource?: ImportSource
}

const PopupContainer: React.FC<Props> = ({ resolve, initialSource }) => {
  const [open, setOpen] = useState(true)
  const [selecting, setSelecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [source, setSource] = useState<ImportSource>(initialSource || 'auto')
  const [importAllBranches, setImportAllBranches] = useState(false)
  const { t } = useTranslation()

  // Import a single file
  const importSingleFile = async () => {
    const filterName =
      source === 'auto' ? 'Conversations' : source === 'chatgpt' ? 'ChatGPT Conversations' : 'Claude Conversations'
    const file = await window.api.file.open({
      filters: [{ name: filterName, extensions: ['json'] }]
    })

    if (!file) {
      return null
    }

    const fileContent = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
    const importerName = source === 'auto' ? undefined : source
    return ImportService.importConversations(fileContent, importerName)
  }

  // Import Claude folder with multiple JSON files (batch import into single assistant)
  const importClaudeFolder = async () => {
    const folderPath = await window.api.file.selectFolder({
      title: t('import.claude.selectFolder', { defaultValue: 'Select Claude Export Folder' })
    })

    if (!folderPath) {
      return null
    }

    // List all files in the folder recursively
    // listDirectory returns an array of file path strings
    const filePaths: string[] = await window.api.file.listDirectory(folderPath, {
      recursive: true,
      maxDepth: 10, // Claude exports can have deeply nested folder structures
      includeFiles: true,
      includeDirectories: false,
      maxEntries: 10000, // Override default limit of 20 to handle large exports
      searchPattern: '.json'
    })

    logger.info('Found files', { count: filePaths?.length, sample: filePaths?.slice(0, 5) })

    // Helper: check for absolute path on both Unix and Windows
    const isAbsolutePath = (p: string) => p.startsWith('/') || /^[A-Za-z]:/.test(p)

    // Log any non-absolute paths for debugging
    const invalidPaths = (filePaths || []).filter((p: string) => !isAbsolutePath(p))
    if (invalidPaths.length > 0) {
      logger.warn('Found non-absolute paths', { count: invalidPaths.length, sample: invalidPaths.slice(0, 5) })
    }

    // Filter to only JSON files (exclude summary files and artifacts folders)
    const jsonFilePaths = (filePaths || []).filter((filePath: string) => {
      // Must be an absolute path (Unix: /... or Windows: C:/...)
      if (!isAbsolutePath(filePath)) return false
      const fileName = filePath.split('/').pop() || ''
      const isJson = fileName.endsWith('.json')
      const isNotSummary = fileName !== '.json' // Exclude summary file at root
      const isNotInArtifacts = !filePath.includes('/artifacts/') // Exclude artifact JSON files
      return isJson && isNotSummary && isNotInArtifacts
    })

    logger.info('Filtered JSON files', { count: jsonFilePaths?.length, sample: jsonFilePaths?.slice(0, 3) })

    if (jsonFilePaths.length === 0) {
      return {
        success: false,
        error: t('import.claude.error.no_json_files', {
          defaultValue: 'No JSON files found in the selected folder. Make sure you selected the Claude export folder.'
        }),
        topicsCount: 0,
        messagesCount: 0
      }
    }

    setImportProgress({ current: 0, total: jsonFilePaths.length })

    // Process files in chunks - read, import, and discard each chunk immediately
    // This prevents memory buildup from loading all files at once
    const CHUNK_SIZE = 50 // Smaller chunks for better memory management
    const totalChunks = Math.ceil(jsonFilePaths.length / CHUNK_SIZE)

    logger.info('Processing files', { total: jsonFilePaths.length, chunks: totalChunks, chunkSize: CHUNK_SIZE })

    // Use streaming import - process each chunk immediately
    const result = await ImportService.importStreamingChunks(
      jsonFilePaths,
      CHUNK_SIZE,
      async (filePath: string) => {
        // Read single file - called by ImportService for each file
        return await window.api.fs.readText(filePath)
      },
      'claude',
      (current, total) => setImportProgress({ current, total }),
      { importAllBranches }
    )

    return result
  }

  const onOk = async () => {
    setSelecting(true)
    try {
      setSelecting(false)
      setImporting(true)

      // For Claude, use folder selection; for others, use file selection
      const result = source === 'claude' ? await importClaudeFolder() : await importSingleFile()

      if (!result) {
        // User cancelled
        setImporting(false)
        return
      }

      if (result.success) {
        window.toast.success(
          t('import.success', {
            topics: result.topicsCount,
            messages: result.messagesCount,
            defaultValue: `Successfully imported ${result.topicsCount} conversations with ${result.messagesCount} messages`
          })
        )
        setOpen(false)
      } else {
        window.toast.error(result.error || t('import.error.unknown', { defaultValue: 'Unknown error occurred' }))
      }
    } catch (error) {
      window.toast.error(t('import.error.unknown', { defaultValue: 'Unknown error occurred' }))
      setOpen(false)
    } finally {
      setSelecting(false)
      setImporting(false)
      setImportProgress({ current: 0, total: 0 })
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  ImportPopup.hide = onCancel

  const getHelpContent = () => {
    if (source === 'claude') {
      return (
        <Alert
          message={t('import.claude.help.title', { defaultValue: 'How to export from Claude' })}
          description={
            <div>
              <p>
                {t('import.claude.help.step1', {
                  defaultValue: '1. Install the Claude Exporter extension (agoramachina/claude-exporter)'
                })}
              </p>
              <p>{t('import.claude.help.step2', { defaultValue: '2. Go to Claude.ai and open the extension' })}</p>
              <p>
                {t('import.claude.help.step3', {
                  defaultValue: '3. Click "Export All" or select specific conversations'
                })}
              </p>
              <p>
                {t('import.claude.help.step4', {
                  defaultValue: '4. Choose JSON format and enable "Include Thinking" for extended thinking'
                })}
              </p>
              <p>
                {t('import.claude.help.step5', {
                  defaultValue: '5. Select the exported folder (contains one JSON per conversation)'
                })}
              </p>
              <p style={{ marginTop: 8, fontStyle: 'italic', opacity: 0.8 }}>
                {t('import.claude.help.note', {
                  defaultValue: 'Artifacts (code), thinking blocks, and tool calls are preserved.'
                })}
              </p>
            </div>
          }
          type="info"
          showIcon
          style={{ marginTop: 12 }}
        />
      )
    }

    if (source === 'chatgpt') {
      return (
        <Alert
          message={t('import.chatgpt.help.title')}
          description={
            <div>
              <p>{t('import.chatgpt.help.step1')}</p>
              <p>{t('import.chatgpt.help.step2')}</p>
              <p>{t('import.chatgpt.help.step3')}</p>
            </div>
          }
          type="info"
          showIcon
          style={{ marginTop: 12 }}
        />
      )
    }

    // Auto-detect
    return (
      <Alert
        message={t('import.auto.help.title', { defaultValue: 'Auto-detect format' })}
        description={t('import.auto.help.description', {
          defaultValue: 'Select a JSON file and we will automatically detect whether it is from ChatGPT or Claude.'
        })}
        type="info"
        showIcon
        style={{ marginTop: 12 }}
      />
    )
  }

  // Get title based on source
  const getTitle = () => {
    if (source === 'claude') {
      return t('import.claude.title', { defaultValue: 'Import from Claude' })
    }
    if (source === 'chatgpt') {
      return t('import.chatgpt.title', { defaultValue: 'Import from ChatGPT' })
    }
    return t('import.title', { defaultValue: 'Import Conversations' })
  }

  return (
    <Modal
      title={getTitle()}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okText={
        source === 'claude'
          ? t('import.button.folder', { defaultValue: 'Select Folder' })
          : t('import.button', { defaultValue: 'Select File' })
      }
      okButtonProps={{ disabled: selecting || importing, loading: selecting }}
      cancelButtonProps={{ disabled: selecting || importing }}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      {!selecting && !importing && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            {source === 'claude'
              ? t('import.claude.description', {
                  defaultValue:
                    'Import conversations from Claude. Only text content is imported; images and attachments are not included.'
                })
              : t('import.description', {
                  defaultValue:
                    'Import conversations from external AI assistants. Only text content is imported; images and attachments are not included.'
                })}
          </div>

          {/* Only show source selector when no initialSource is specified */}
          {!initialSource && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>
                {t('import.source.label', { defaultValue: 'Source:' })}
              </div>
              <Radio.Group value={source} onChange={(e) => setSource(e.target.value)}>
                <Radio.Button value="auto">{t('import.source.auto', { defaultValue: 'Auto-detect' })}</Radio.Button>
                <Radio.Button value="chatgpt">ChatGPT</Radio.Button>
                <Radio.Button value="claude">Claude</Radio.Button>
              </Radio.Group>
            </div>
          )}

          {/* Claude-specific options */}
          {source === 'claude' && (
            <div style={{ marginTop: 16 }}>
              <Checkbox checked={importAllBranches} onChange={(e) => setImportAllBranches(e.target.checked)}>
                {t('import.claude.option.allBranches', {
                  defaultValue: 'Import all branches (includes edit history and regenerations)'
                })}
              </Checkbox>
            </div>
          )}

          {getHelpContent()}
        </Space>
      )}
      {selecting && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>{t('import.selecting', { defaultValue: 'Selecting file...' })}</div>
        </div>
      )}
      {importing && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress
            percent={importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 100}
            status="active"
            strokeColor="var(--color-primary)"
            showInfo={importProgress.total > 1}
          />
          <div style={{ marginTop: 16 }}>
            {importProgress.total > 1
              ? t('import.importing_progress', {
                  current: importProgress.current,
                  total: importProgress.total,
                  defaultValue: `Importing file ${importProgress.current} of ${importProgress.total}...`
                })
              : t('import.importing', { defaultValue: 'Importing conversations...' })}
          </div>
        </div>
      )}
    </Modal>
  )
}

const TopViewKey = 'ImportPopup'

export default class ImportPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(initialSource?: ImportSource) {
    return new Promise<PopupResult>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
          initialSource={initialSource}
        />,
        TopViewKey
      )
    })
  }
}

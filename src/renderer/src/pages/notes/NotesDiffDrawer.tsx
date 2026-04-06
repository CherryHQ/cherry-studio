import { loggerService } from '@logger'
import { useFileContentSync } from '@renderer/hooks/useNotesQuery'
import { modalConfirm } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { Button, Drawer, Empty, Select, Spin } from 'antd'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('NotesDiffDrawer')

type CommitHistoryItem = {
  hash: string
  date: string
  message: string
}

interface NotesDiffDrawerProps {
  open: boolean
  onClose: () => void
  notesPath: string
  filePath?: string
  /**
   * 恢复前的钩子：用于取消笔记页面上的防抖保存、清理临时状态，避免恢复后被旧内容覆盖。
   */
  onBeforeRestore?: () => void
}

const getFileName = (filePath?: string) => {
  if (!filePath) {
    return ''
  }
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

const getDiffLineType = (line: string) => {
  if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) {
    return 'meta'
  }
  if (line.startsWith('+')) {
    return 'add'
  }
  if (line.startsWith('-')) {
    return 'remove'
  }
  return 'normal'
}

const isHiddenDiffLine = (line: string) => {
  if (!line) {
    return false
  }
  if (line.startsWith('diff --git ')) {
    return true
  }
  if (line.startsWith('index ')) {
    return true
  }
  if (line.startsWith('+++') || line.startsWith('---')) {
    return true
  }
  if (line.startsWith('@@')) {
    return true
  }
  if (line.startsWith('new file mode') || line.startsWith('deleted file mode')) {
    return true
  }
  if (line.startsWith('similarity index') || line.startsWith('rename from') || line.startsWith('rename to')) {
    return true
  }
  if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
    return true
  }
  return false
}

const NotesDiffDrawer: FC<NotesDiffDrawerProps> = ({ open, onClose, notesPath, filePath, onBeforeRestore }) => {
  const { t } = useTranslation()
  const { invalidateFileContent, refetchFileContent } = useFileContentSync()
  const [history, setHistory] = useState<CommitHistoryItem[]>([])
  const [selectedCommit, setSelectedCommit] = useState<string>()
  const [diff, setDiff] = useState('')
  const [diffTruncated, setDiffTruncated] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const fileName = useMemo(() => getFileName(filePath), [filePath])
  const canRestore = Boolean(open && notesPath && filePath && selectedCommit && !loadingHistory && !restoring)

  const handleRestoreToCommit = async () => {
    if (!notesPath || !filePath || !selectedCommit) {
      return
    }

    const commitShort = selectedCommit.slice(0, 7)
    const confirmed = await modalConfirm({
      title: t('notes.diff.restore_confirm_title'),
      content: t('notes.diff.restore_confirm_content', {
        commitHash: commitShort,
        fileName: fileName || filePath
      }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel')
    })
    if (!confirmed) {
      return
    }

    // 避免恢复后被未触发的防抖保存写回旧内容
    onBeforeRestore?.()
    setRestoring(true)
    try {
      await window.api.notesGit.restoreFile(notesPath, filePath, selectedCommit)
      // 立即刷新内容：不要依赖主进程 watcher 的 1s 防抖
      invalidateFileContent(filePath)
      await refetchFileContent(filePath)
      window.toast.success(t('notes.diff.restore_success'))
      onClose()
    } catch (error) {
      logger.error('Failed to restore notes file:', error as Error)
      window.toast.error(`${t('notes.diff.restore_failed')}: ${formatErrorMessage(error)}`)
    } finally {
      setRestoring(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadHistory = async () => {
      if (!open) {
        return
      }
      if (!notesPath || !filePath) {
        setHistory([])
        setSelectedCommit(undefined)
        setDiff('')
        setDiffTruncated(false)
        return
      }

      setLoadingHistory(true)
      try {
        const result = await window.api.notesGit.getFileHistory(notesPath, filePath)
        if (cancelled) {
          return
        }
        setHistory(result)
        setSelectedCommit(result[0]?.hash)
      } catch (error) {
        logger.error('Failed to load notes git history:', error as Error)
        if (!cancelled) {
          setHistory([])
          setSelectedCommit(undefined)
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false)
        }
      }
    }

    void loadHistory()
    return () => {
      cancelled = true
    }
  }, [open, notesPath, filePath])

  useEffect(() => {
    let cancelled = false

    const loadDiff = async () => {
      if (!open) {
        return
      }
      if (!notesPath || !filePath || !selectedCommit) {
        setDiff('')
        setDiffTruncated(false)
        return
      }

      setLoadingDiff(true)
      try {
        const result = await window.api.notesGit.getFileDiff(notesPath, filePath, selectedCommit)
        if (cancelled) {
          return
        }
        setDiff(result.diff)
        setDiffTruncated(result.truncated)
      } catch (error) {
        logger.error('Failed to load notes git diff:', error as Error)
        if (!cancelled) {
          setDiff('')
          setDiffTruncated(false)
        }
      } finally {
        if (!cancelled) {
          setLoadingDiff(false)
        }
      }
    }

    void loadDiff()
    return () => {
      cancelled = true
    }
  }, [open, notesPath, filePath, selectedCommit])

  const historyOptions = useMemo(
    () =>
      history.map((item) => ({
        label: `${item.date} - ${item.message || t('notes.diff.no_message')}`,
        value: item.hash
      })),
    [history, t]
  )

  const diffLines = useMemo(() => diff.split('\n'), [diff])
  const displayLines = useMemo(() => diffLines.filter((line) => !isHiddenDiffLine(line)), [diffLines])
  const diffStats = useMemo(() => {
    let additions = 0
    let deletions = 0
    displayLines.forEach((line) => {
      if (line.startsWith('+')) {
        additions += 1
      } else if (line.startsWith('-')) {
        deletions += 1
      }
    })
    return { additions, deletions }
  }, [displayLines])
  const showEmptyFile = !filePath
  const showEmptyHistory = !loadingHistory && !showEmptyFile && history.length === 0
  const showEmptyDiff = !loadingDiff && Boolean(selectedCommit) && displayLines.every((line) => line.trim() === '')

  return (
    <Drawer
      title={
        <HeaderTitle>
          <div>{t('notes.diff.title')}</div>
          {fileName && <HeaderMeta>{fileName}</HeaderMeta>}
        </HeaderTitle>
      }
      open={open}
      onClose={onClose}
      placement="right"
      width={520}
      styles={{
        header: { borderBottom: '1px solid var(--color-border)' },
        body: { padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
      }}>
      {showEmptyFile ? (
        <EmptyWrapper>
          <Empty description={t('notes.diff.no_file')} />
        </EmptyWrapper>
      ) : loadingHistory ? (
        <EmptyWrapper>
          <Spin />
        </EmptyWrapper>
      ) : showEmptyHistory ? (
        <EmptyWrapper>
          <Empty description={t('notes.diff.no_history')} />
        </EmptyWrapper>
      ) : (
        <>
          <Toolbar>
            <Select
              placeholder={t('notes.diff.select_commit')}
              options={historyOptions}
              value={selectedCommit}
              onChange={(value) => setSelectedCommit(value)}
              style={{ width: '100%' }}
              disabled={loadingHistory || historyOptions.length === 0}
            />
            {loadingDiff && <Spin size="small" />}
          </Toolbar>
          {diffTruncated && <Notice>{t('notes.diff.truncated')}</Notice>}
          <DiffCard>
            <DiffHeader>
              <DiffHeaderTitle>
                {t('notes.diff.edited')}
                {fileName ? ` ${fileName}` : ''}
              </DiffHeaderTitle>
              <DiffHeaderStats>
                <DiffStat $type="add">+{diffStats.additions}</DiffStat>
                <DiffStat $type="remove">-{diffStats.deletions}</DiffStat>
                <Button
                  danger
                  size="small"
                  type="primary"
                  loading={restoring}
                  disabled={!canRestore}
                  onClick={handleRestoreToCommit}>
                  {t('notes.diff.restore')}
                </Button>
              </DiffHeaderStats>
            </DiffHeader>
            <DiffContainer>
              {showEmptyDiff ? (
                <Empty description={t('notes.diff.no_changes')} />
              ) : (
                displayLines.map((line, index) => (
                  <DiffLine key={`${index}-${line}`} $type={getDiffLineType(line)}>
                    {line || ' '}
                  </DiffLine>
                ))
              )}
            </DiffContainer>
          </DiffCard>
        </>
      )}
    </Drawer>
  )
}

const HeaderTitle = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const HeaderMeta = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
`

const Notice = styled.div`
  padding: 8px 12px;
  font-size: 12px;
  color: var(--color-status-warning);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
`

const DiffCard = styled.div`
  margin: 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  min-height: 0;
`

const DiffHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
`

const DiffHeaderTitle = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const DiffHeaderStats = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
`

const DiffStat = styled.span<{ $type: 'add' | 'remove' }>`
  color: ${({ $type }) => ($type === 'add' ? 'var(--color-status-success)' : 'var(--color-status-error)')};
  font-weight: 600;
`

const DiffContainer = styled.div`
  flex: 1;
  overflow: auto;
  padding: 12px;
`

const DiffLine = styled.div<{ $type: 'add' | 'remove' | 'meta' | 'normal' }>`
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: ${({ $type }) => {
    if ($type === 'add') return 'var(--color-status-success)'
    if ($type === 'remove') return 'var(--color-status-error)'
    if ($type === 'meta') return 'var(--color-text-3)'
    return 'var(--color-text-1)'
  }};
  background-color: ${({ $type }) => {
    if ($type === 'add') return 'color-mix(in srgb, var(--color-status-success) 12%, transparent)'
    if ($type === 'remove') return 'color-mix(in srgb, var(--color-status-error) 22%, transparent)'
    if ($type === 'meta') return 'var(--color-background-mute)'
    return 'transparent'
  }};
  border-left: 2px solid
    ${({ $type }) => {
      if ($type === 'add') return 'var(--color-status-success)'
      if ($type === 'remove') return 'var(--color-status-error)'
      if ($type === 'meta') return 'var(--color-border)'
      return 'transparent'
    }};
  padding: 2px 8px;
`

const EmptyWrapper = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`

export default NotesDiffDrawer

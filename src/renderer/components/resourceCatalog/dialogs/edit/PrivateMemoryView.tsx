import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '@cherrystudio/ui'
import { MarkdownHostProvider, StaticMarkdown } from '@renderer/components/markdown'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'

export function usePrivateMemoryIndex(agentId: string, activeTab: boolean, revision: number) {
  const [index, setIndex] = useState<OutputFor<'memory.private.list'> | null>()
  useEffect(() => {
    if (!activeTab) return
    let active = true
    setIndex(undefined)
    void ipcApi.request('memory.private.list', { agentId }).then(
      (value) => {
        if (active) setIndex(value)
      },
      () => {
        if (active) setIndex(null)
      }
    )
    return () => {
      active = false
    }
  }, [agentId, activeTab, revision])
  return index
}

export function PrivateMemoryView({
  agentId,
  index,
  path,
  select
}: {
  agentId: string
  index: ReturnType<typeof usePrivateMemoryIndex>
  path: string
  select: (path: string) => void
}) {
  const { t } = useTranslation()
  if (index === null)
    return (
      <p role="alert" className="py-4 text-sm text-error">
        {t('agent.memory.load_failed')}
      </p>
    )
  if (!index)
    return (
      <p role="status" className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  if (index.status !== 'complete')
    return (
      <p role="status" className="py-4 text-sm text-muted-foreground">
        {t(`agent.memory.private.${index.status}`)}
      </p>
    )

  return (
    <ScrollArea className="min-h-0 flex-1" data-ui="agent.private-memory">
      <PrivateMemoryContent key={path} agentId={agentId} path={path} files={index.files} select={select} />
    </ScrollArea>
  )
}

function PrivateMemoryContent({
  agentId,
  path,
  files,
  select
}: {
  agentId: string
  path: string
  files: string[]
  select: (path: string) => void
}) {
  const { t } = useTranslation()
  const [file, setFile] = useState<OutputFor<'memory.private.read'>>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void ipcApi.request('memory.private.read', { agentId, path }).then(
      (value) => {
        if (active) setFile(value)
      },
      () => {
        if (active) setFailed(true)
      }
    )
    return () => {
      active = false
    }
  }, [agentId, path])

  if (failed)
    return (
      <p role="alert" className="py-4 text-sm text-error">
        {t('agent.memory.load_failed')}
      </p>
    )
  if (!file)
    return (
      <p role="status" className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  if (file.content === null) return <p className="py-4 text-sm text-muted-foreground">{t('agent.memory.not_exists')}</p>
  if (!file.content.trim()) return <p className="py-4 text-sm text-muted-foreground">{t('agent.memory.empty')}</p>
  return (
    <div className="markdown py-4 text-sm">
      <MarkdownHostProvider
        openFilePath={(href) => {
          const relative = href.replace(/^\.\//, '')
          const target = path.startsWith('.memories/') ? '.memories/' + relative : relative
          if (files.includes(target)) select(target)
          else toast.error(t('agent.memory.not_exists'))
        }}>
        <StaticMarkdown id={path}>{file.content}</StaticMarkdown>
      </MarkdownHostProvider>
      {file.truncated && <p>{t('agent.memory.truncated', { part: t('agent.memory.truncated_head') })}</p>}
    </div>
  )
}

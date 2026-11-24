import { FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollArea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { MarkdownHostProvider, StaticMarkdown } from '@renderer/components/markdown'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'

export function PrivateMemoryView({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState<OutputFor<'memory.private.list'>>()
  const [failed, setFailed] = useState(false)
  const [path, setPath] = useState('MEMORY.md')
  useEffect(() => {
    let active = true
    void ipcApi.request('memory.private.list', { agentId }).then(
      (value) => {
        if (active) setIndex(value)
      },
      () => {
        if (active) setFailed(true)
      }
    )
    return () => {
      active = false
    }
  }, [agentId])

  if (failed)
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-ui="agent.private-memory">
      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle py-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {index.files.some((file) => file !== 'MEMORY.md') ? (
          <Select value={path} onValueChange={setPath}>
            <SelectTrigger size="sm" className="min-w-0 max-w-full" aria-label={t('files.select_file', { name: path })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['MEMORY.md', ...index.files.filter((file) => file !== 'MEMORY.md')].map((file) => (
                <SelectItem key={file} value={file}>
                  {file}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm font-medium">MEMORY.md</span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <PrivateMemoryContent key={path} agentId={agentId} path={path} files={index.files} select={setPath} />
      </ScrollArea>
    </section>
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

import { FolderOpen, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  ScrollArea
} from '@cherrystudio/ui'
import { MarkdownHostProvider, StaticMarkdown } from '@renderer/components/markdown'
import { PromptEditorIconButton } from '@renderer/components/PromptEditorField'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'

function usePrivateMemoryIndex(agentId: string, revision: number) {
  const [index, setIndex] = useState<OutputFor<'memory.private.list'> | null>()
  useEffect(() => {
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
  }, [agentId, revision])
  return index
}

export function PrivateMemoryPage({ agentId, openFolder }: { agentId: string; openFolder: () => Promise<void> }) {
  const { t } = useTranslation()
  const [revision, refresh] = useState(0)
  const [path, select] = useState('MEMORY.md')
  const index = usePrivateMemoryIndex(agentId, revision)
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span className="truncate text-muted-foreground text-xs">{path}</span>
        <div className="flex items-center gap-1.5">
          <PromptEditorIconButton
            label={t('agent.memory.open_folder')}
            icon={<FolderOpen className="size-3" />}
            onClick={() => void openFolder()}
            showLabel
          />
          <PromptEditorIconButton
            label={t('agent.memory.refresh')}
            icon={<RefreshCw className="size-3" />}
            onClick={() => refresh((value) => value + 1)}
          />
          {index?.files.some((file) => file !== 'MEMORY.md') && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.more')}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={path} onValueChange={select} className="max-h-56 overflow-y-auto">
                  {['MEMORY.md', ...index.files.filter((file) => file !== 'MEMORY.md')].map((file) => (
                    <DropdownMenuRadioItem key={file} value={file}>
                      <span className="max-w-64 truncate">{file}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <PrivateMemoryView key={revision} agentId={agentId} index={index} path={path} select={select} />
    </>
  )
}

function PrivateMemoryView({
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

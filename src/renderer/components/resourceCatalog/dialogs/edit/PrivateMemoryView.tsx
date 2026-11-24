import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea } from '@cherrystudio/ui'
import { StaticMarkdown } from '@renderer/components/markdown'
import { ipcApi } from '@renderer/ipc'
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

  if (failed) return <p role="alert">{t('agent.memory.load_failed')}</p>
  if (!index) return <p role="status">{t('common.loading')}</p>
  if (index.status !== 'complete') return <p role="status">{t(`agent.memory.private.${index.status}`)}</p>

  return (
    <ScrollArea className="min-h-0 flex-1">
      {index.files.some((file) => file !== 'MEMORY.md') && (
        <nav className="flex flex-wrap gap-1 py-2" aria-label={t('agent.memory.private.title')}>
          {index.files.map((file) => (
            <Button
              key={file}
              size="sm"
              variant={file === path ? 'secondary' : 'ghost'}
              aria-pressed={file === path}
              onClick={() => setPath(file)}>
              {file}
            </Button>
          ))}
        </nav>
      )}
      <PrivateMemoryContent key={path} agentId={agentId} path={path} files={index.files} select={setPath} />
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

  if (failed) return <p role="alert">{t('agent.memory.load_failed')}</p>
  if (!file) return <p role="status">{t('common.loading')}</p>
  if (file.content === null) return <p>{t('agent.memory.not_exists')}</p>
  if (!file.content.trim()) return <p>{t('agent.memory.empty')}</p>
  return (
    <div className="markdown py-4 text-sm">
      <StaticMarkdown
        id={path}
        components={{
          a: ({ href, children }) => {
            const relative = href?.replace(/^\.\//, '')
            const target = path.startsWith('.memories/') ? '.memories/' + relative : relative
            return target && files.includes(target) ? (
              <button type="button" className="cursor-pointer text-primary underline" onClick={() => select(target)}>
                {children}
              </button>
            ) : (
              <span>{children}</span>
            )
          }
        }}>
        {file.content}
      </StaticMarkdown>
      {file.truncated && <p>{t('agent.memory.truncated', { part: t('agent.memory.truncated_head') })}</p>}
    </div>
  )
}

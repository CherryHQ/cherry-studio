import { MoreOutlined } from '@ant-design/icons'
import { Icon } from '@iconify/react'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { buildEditorUrl, getEditorIcon } from '@renderer/utils/editorUtils'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { Dropdown, type MenuProps, Tooltip } from 'antd'
import { FolderOpen } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(p)
}

function resolveRelativePath(relativePath: string, basePath: string): string {
  const normalizedBase = basePath.replace(/\\/g, '/')
  const normalizedRel = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const joined = normalizedBase.endsWith('/') ? normalizedBase + normalizedRel : normalizedBase + '/' + normalizedRel
  const parts = joined.split('/')
  const result: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (result.length > 0 && !/^[a-zA-Z]:$/.test(result[result.length - 1])) {
        result.pop()
      }
      continue
    }
    result.push(part)
  }
  const prefix = normalizedBase.startsWith('/') ? '/' : ''
  return prefix + result.join('/')
}

interface ClickableFilePathProps {
  path: string
  displayName?: string
}

export const ClickableFilePath = memo(function ClickableFilePath({ path, displayName }: ClickableFilePathProps) {
  const { t } = useTranslation()
  const { data: externalApps } = useExternalApps()
  const { session } = useActiveSession()

  const resolvedPath = useMemo(() => {
    if (isAbsolutePath(path)) return path
    const workspacePath = session?.accessiblePaths?.[0]
    if (!workspacePath) return path
    return resolveRelativePath(path, workspacePath)
  }, [path, session?.accessiblePaths?.[0]])

  const iconName = useMemo(() => getFileIconName(path), [path])

  const availableEditors = useMemo(
    () => externalApps?.filter((app) => app.tags.includes('code-editor')) ?? [],
    [externalApps]
  )

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      window.open(buildEditorUrl(app, resolvedPath))
    },
    [resolvedPath]
  )

  const handleOpen = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation()
      window.api.file.openPath(resolvedPath).catch(() => {
        window.toast.error(t('chat.input.tools.open_file_error', { path }))
      })
    },
    [resolvedPath, path, t]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleOpen(e)
      }
    },
    [handleOpen]
  )

  const menuItems: MenuProps['items'] = useMemo(() => {
    const items: MenuProps['items'] = [
      {
        key: 'reveal',
        label: t('chat.input.tools.reveal_in_finder'),
        icon: <FolderOpen size={16} />,
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation()
          window.api.file.showInFolder(resolvedPath).catch(() => {
            window.toast.error(t('chat.input.tools.file_not_found', { path }))
          })
        }
      }
    ]

    if (availableEditors.length > 0) {
      items.push({ type: 'divider' })
      for (const app of availableEditors) {
        items.push({
          key: app.id,
          label: app.name,
          icon: getEditorIcon(app),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation()
            openInEditor(app)
          }
        })
      }
    }

    return items
  }, [resolvedPath, t, availableEditors, openInEditor])

  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip title={path} mouseEnterDelay={0.5}>
        <span
          role="link"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={handleKeyDown}
          className="inline-flex cursor-pointer items-center gap-1 hover:underline"
          style={{ color: 'var(--color-link)', wordBreak: 'break-all' }}>
          <Icon icon={`material-icon-theme:${iconName}`} className="shrink-0" style={{ fontSize: '1.1em' }} />
          {displayName ?? path}
        </span>
      </Tooltip>
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <Tooltip title={t('common.more')} mouseEnterDelay={0.5}>
          <MoreOutlined
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer rounded px-0.5 opacity-60 hover:bg-black/10 hover:opacity-100"
            style={{ color: 'var(--color-link)', fontSize: '14px' }}
          />
        </Tooltip>
      </Dropdown>
    </span>
  )
})

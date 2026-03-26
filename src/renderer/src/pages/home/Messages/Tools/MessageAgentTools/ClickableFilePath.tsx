import { MoreOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { isLinux } from '@renderer/config/constant'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { buildEditorUrl, getEditorIcon, getFileManagerIcon, getTerminalIcon } from '@renderer/utils/editorUtils'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { Dropdown, type MenuProps, Tooltip } from 'antd'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ClickableFilePath')

interface ClickableFilePathProps {
  path: string
  displayName?: string
}

export const ClickableFilePath = memo(function ClickableFilePath({ path, displayName }: ClickableFilePathProps) {
  const { t } = useTranslation()
  const { data: externalApps } = useExternalApps()
  const [availableTerminals, setAvailableTerminals] = useState<{ id: string; name: string }[]>([])

  const availableEditors = useMemo(
    () => externalApps?.filter((app) => app.tags.includes('code-editor')) ?? [],
    [externalApps]
  )

  useEffect(() => {
    if (isLinux) return
    window.api.codeTools
      .getAvailableTerminals()
      .then(setAvailableTerminals)
      .catch((e) => logger.error('Failed to load terminals:', e as Error))
  }, [])

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      window.open(buildEditorUrl(app, path))
    },
    [path]
  )

  const openInTerminal = useCallback(
    (terminalId: string) => {
      window.api.externalApps.openTerminal(path, terminalId).catch((e) => {
        logger.error('Failed to open terminal:', e as Error)
        window.toast.error(t('code.launch.error'))
      })
    },
    [path, t]
  )

  const handleOpen = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation()
      window.api.file.openPath(path).catch(() => {
        window.toast.error(t('chat.input.tools.open_file_error', { path }))
      })
    },
    [path, t]
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
        icon: getFileManagerIcon(16),
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation()
          window.api.file.showInFolder(path).catch(() => {
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

    if (availableTerminals.length > 0) {
      items.push({ type: 'divider' })
      for (const terminal of availableTerminals) {
        items.push({
          key: `terminal-${terminal.id}`,
          label: terminal.name,
          icon: getTerminalIcon(terminal.id),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation()
            openInTerminal(terminal.id)
          }
        })
      }
    }

    return items
  }, [path, t, availableEditors, availableTerminals, openInEditor, openInTerminal])

  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip title={path} mouseEnterDelay={0.5}>
        <span
          role="link"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={handleKeyDown}
          className="cursor-pointer hover:underline"
          style={{ color: 'var(--color-link)', wordBreak: 'break-all' }}>
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

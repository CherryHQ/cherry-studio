import { DownOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import FileExplorerIcon from '@renderer/assets/images/apps/file-explorer.png'
import FinderIcon from '@renderer/assets/images/apps/finder.png'
import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { buildEditorUrl, getEditorIcon, getTerminalIcon } from '@renderer/utils/editorUtils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { Button, Dropdown, type MenuProps, Space, Tooltip } from 'antd'
import { Folder } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OpenExternalAppButton')

type OpenExternalAppButtonProps = {
  workdir: string
  className?: string
}

const OpenExternalAppButton = ({ workdir, className }: OpenExternalAppButtonProps) => {
  const { t } = useTranslation()
  const { data: externalApps } = useExternalApps()
  const [availableTerminals, setAvailableTerminals] = useState<{ id: string; name: string }[]>([])

  const availableEditors = useMemo(() => {
    if (!externalApps) {
      return []
    }
    return externalApps.filter((app) => app.tags.includes('code-editor'))
  }, [externalApps])

  useEffect(() => {
    if (isLinux) return
    window.api.codeTools
      .getAvailableTerminals()
      .then(setAvailableTerminals)
      .catch((e) => logger.error('Failed to load terminals:', e as Error))
  }, [])

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      switch (app.id) {
        case 'vscode':
        case 'cursor':
        case 'zed':
          window.open(buildEditorUrl(app, workdir))
          break
        default:
          logger.error(`Unexpected Error: External app not found: ${app.id}`)
          window.toast.error(`Unexpected Error: External app not found: ${app.id}`)
      }
    },
    [workdir]
  )

  const openInTerminal = useCallback(
    (terminalId: string) => {
      window.api.externalApps.openTerminal(workdir, terminalId).catch((e) => {
        logger.error('Failed to open terminal:', e as Error)
        window.toast.error(t('code.launch.error'))
      })
    },
    [workdir, t]
  )

  // TODO: migrate it to preferences in v2
  const [selectedEditorId, setSelectedEditorId] = useState<string | null>(null)

  const selectedEditor = useMemo(() => {
    return availableEditors.find((app) => app.id === selectedEditorId) ?? availableEditors[0]
  }, [availableEditors, selectedEditorId])

  const openInFileManager = useCallback(() => {
    window.api.file
      .openPath(workdir)
      .catch((e) => window.toast.error(formatErrorMessageWithPrefix(e, t('files.error.open_path', { path: workdir }))))
  }, [workdir, t])

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    if (e.key === 'file-manager') {
      openInFileManager()
      return
    }

    // Check if it's a terminal
    const terminal = availableTerminals.find((t) => `terminal-${t.id}` === e.key)
    if (terminal) {
      openInTerminal(terminal.id)
      return
    }

    // Otherwise it's an editor
    const config = availableEditors.find((app) => app.id === e.key)
    if (!config) {
      logger.error(`Unexpected Error: External app not found: ${e.key}`)
      window.toast.error(`Unexpected Error: External app not found: ${e.key}`)
      return
    }
    setSelectedEditorId(config.id)
    openInEditor(config)
  }

  const fileManagerIcon = isMac ? (
    <img src={FinderIcon} alt="Finder" width={16} height={16} />
  ) : isWin ? (
    <img src={FileExplorerIcon} alt="Explorer" width={16} height={16} />
  ) : (
    <Folder size={16} />
  )

  const fileManagerName = isMac ? 'Finder' : isWin ? 'Explorer' : t('code.file_manager')

  const items: MenuProps['items'] = useMemo(() => {
    const editorItems = availableEditors.map((app) => ({
      label: app.name,
      key: app.id,
      icon: getEditorIcon(app)
    }))

    const terminalItems = availableTerminals.map((terminal) => ({
      label: terminal.name,
      key: `terminal-${terminal.id}`,
      icon: getTerminalIcon(terminal.id)
    }))

    const fileManagerItem = {
      label: fileManagerName,
      key: 'file-manager',
      icon: fileManagerIcon
    }

    const groups: MenuProps['items'] = [...editorItems]
    if (terminalItems.length > 0) {
      if (groups.length > 0) groups.push({ type: 'divider' })
      groups.push(...terminalItems)
    }
    if (groups.length > 0) groups.push({ type: 'divider' })
    groups.push(fileManagerItem)

    return groups
  }, [availableEditors, availableTerminals, fileManagerIcon, fileManagerName])

  if (!workdir) {
    return null
  }

  return (
    <Space.Compact className={className}>
      <Tooltip title={t('common.open_in', { name: selectedEditor?.name ?? 'Terminal' })} mouseEnterDelay={0.5}>
        <Button
          onClick={() => {
            if (selectedEditor) {
              openInEditor(selectedEditor)
            } else if (availableTerminals.length > 0) {
              openInTerminal(availableTerminals[0].id)
            }
          }}
          icon={
            selectedEditor
              ? getEditorIcon(selectedEditor)
              : availableTerminals.length > 0
                ? getTerminalIcon(availableTerminals[0].id)
                : null
          }
        />
      </Tooltip>
      <Dropdown menu={{ items, onClick: handleMenuClick }} placement="bottomRight">
        <Button icon={<DownOutlined />} />
      </Dropdown>
    </Space.Compact>
  )
}

export default OpenExternalAppButton

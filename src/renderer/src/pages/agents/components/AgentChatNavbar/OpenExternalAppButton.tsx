import { DownOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { buildEditorUrl, getEditorIcon } from '@renderer/utils/editorUtils'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { Button, Dropdown, type MenuProps, Space, Tooltip } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OpenExternalAppButton')

type OpenExternalAppButtonProps = {
  workdir: string
  className?: string
}

const OpenExternalAppButton = ({ workdir, className }: OpenExternalAppButtonProps) => {
  const { t } = useTranslation()
  const { data: externalApps } = useExternalApps()
  const availableEditors = useMemo(() => {
    if (!externalApps) {
      return []
    }
    return externalApps.filter((app) => app.tags.includes('code-editor'))
  }, [externalApps])

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

  // TODO: migrate it to preferences in v2
  const [selectedEditorId, setSelectedEditorId] = useState<string | null>(null)

  const selectedEditor = useMemo(() => {
    return availableEditors.find((app) => app.id === selectedEditorId) ?? availableEditors[0]
  }, [availableEditors, selectedEditorId])

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    const config = availableEditors.find((app) => app.id === e.key)
    if (!config) {
      logger.error(`Unexpected Error: External app not found: ${e.key}`)
      window.toast.error(`Unexpected Error: External app not found: ${e.key}`)
      return
    }
    setSelectedEditorId(config.id)
    openInEditor(config)
  }

  const items: MenuProps['items'] = useMemo(() => {
    return availableEditors.map((app) => ({ label: app.name, key: app.id, icon: getEditorIcon(app) }))
  }, [availableEditors])

  const menuProps = {
    items,
    onClick: handleMenuClick
  }

  if (availableEditors.length === 0 || !selectedEditor) {
    return null
  }

  return (
    <Space.Compact className={className}>
      <Tooltip title={t('common.open_in', { name: selectedEditor.name })} mouseEnterDelay={0.5}>
        <Button onClick={() => openInEditor(selectedEditor)} icon={getEditorIcon(selectedEditor)} />
      </Tooltip>
      <Dropdown menu={menuProps} placement="bottomRight">
        <Button icon={<DownOutlined />} />
      </Dropdown>
    </Space.Compact>
  )
}

export default OpenExternalAppButton

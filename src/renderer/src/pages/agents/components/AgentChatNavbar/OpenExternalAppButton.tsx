import { EllipsisOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { CursorIcon, VSCodeIcon, ZedIcon } from '@renderer/components/Icons/SVGIcon'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { Button, Dropdown, type MenuProps, Space } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OpenExternalAppButton')

const getEditorIcon = (app: ExternalAppInfo) => {
  switch (app.id) {
    case 'vscode':
      return <VSCodeIcon className={'size-4'} />
    case 'cursor':
      return <CursorIcon className={'size-4'} />
    case 'zed':
      return <ZedIcon className={'size-4'} />
  }
}

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
      const encodedPath = workdir.split(/[/\\]/).map(encodeURIComponent).join('/')
      switch (app.id) {
        case 'vscode':
        case 'cursor': {
          // https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls
          // https://github.com/microsoft/vscode/issues/141548#issuecomment-1102200617
          const appUrl = `${app.protocol}file/${encodedPath}?windowId=_blank`
          window.open(appUrl)
          break
        }
        case 'zed': {
          // https://github.com/zed-industries/zed/issues/8482
          // Zed parses URLs by stripping "zed://file" prefix, so the format is
          // zed://file/absolute/path (no extra "/" between "file" and path, no query params)
          const appUrl = `${app.protocol}file${encodedPath}`
          window.open(appUrl)
          break
        }
        default:
          logger.error(`Unexpected Error: External app not found: ${app.id}`)
          window.toast.error(`Unexpected Error: External app not found: ${app.id}`)
      }
    },
    [workdir]
  )

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
      <Button onClick={() => openInEditor(selectedEditor)} icon={getEditorIcon(selectedEditor)}>
        {t('common.open')}
      </Button>
      <Dropdown menu={menuProps} placement="bottomRight">
        <Button icon={<EllipsisOutlined />} />
      </Dropdown>
    </Space.Compact>
  )
}

export default OpenExternalAppButton

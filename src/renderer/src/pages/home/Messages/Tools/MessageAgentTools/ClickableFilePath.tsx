import { EllipsisOutlined } from '@ant-design/icons'
import { CursorIcon, VSCodeIcon, ZedIcon } from '@renderer/components/Icons/SVGIcon'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { Dropdown, type MenuProps } from 'antd'
import { FolderOpen } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface ClickableFilePathProps {
  path: string
  displayName?: string
}

const getEditorIcon = (app: ExternalAppInfo) => {
  switch (app.id) {
    case 'vscode':
      return <VSCodeIcon className="size-4" />
    case 'cursor':
      return <CursorIcon className="size-4" />
    case 'zed':
      return <ZedIcon className="size-4" />
  }
}

export const ClickableFilePath = memo(function ClickableFilePath({ path, displayName }: ClickableFilePathProps) {
  const { t } = useTranslation()
  const { data: externalApps } = useExternalApps()

  const availableEditors = useMemo(
    () => externalApps?.filter((app) => app.tags.includes('code-editor')) ?? [],
    [externalApps]
  )

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      const encodedPath = path.split(/[/\\]/).map(encodeURIComponent).join('/')
      window.open(`${app.protocol}file/${encodedPath}?windowId=_blank`)
    },
    [path]
  )

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      window.api.file.openPath(path).catch(() => {
        window.toast.error(t('chat.input.tools.open_file_error', { path }))
      })
    },
    [path, t]
  )

  const menuItems: MenuProps['items'] = useMemo(() => {
    const items: MenuProps['items'] = [
      {
        key: 'reveal',
        label: t('chat.input.tools.reveal_in_finder'),
        icon: <FolderOpen size={16} />,
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

    return items
  }, [path, t, availableEditors, openInEditor])

  return (
    <span className="inline-flex items-center gap-0.5">
      <span
        onClick={handleOpen}
        className="cursor-pointer hover:underline"
        style={{ color: 'var(--color-link)', wordBreak: 'break-all' }}>
        {displayName ?? path}
      </span>
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <EllipsisOutlined
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer opacity-50 hover:opacity-100"
          style={{ color: 'var(--color-link)', fontSize: '12px' }}
        />
      </Dropdown>
    </span>
  )
})

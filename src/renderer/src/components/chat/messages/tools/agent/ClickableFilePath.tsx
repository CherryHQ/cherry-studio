import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { buildEditorUrl, getEditorIcon } from '@renderer/utils/editorUtils'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { FolderOpen, MoreHorizontal } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface ClickableFilePathProps {
  path: string
  displayName?: string
}

export const ClickableFilePath = memo(function ClickableFilePath({ path, displayName }: ClickableFilePathProps) {
  const { t } = useTranslation()
  const { data: externalApps } = useExternalApps()
  const iconName = useMemo(() => getFileIconName(path), [path])

  const availableEditors = useMemo(
    () => externalApps?.filter((app) => app.tags.includes('code-editor')) ?? [],
    [externalApps]
  )

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      window.open(buildEditorUrl(app, path))
    },
    [path]
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

  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip content={path} delay={500}>
        <span
          role="link"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={handleKeyDown}
          className="inline-flex cursor-pointer items-center gap-1 hover:underline"
          style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>
          <Icon icon={`material-icon-theme:${iconName}`} className="shrink-0" style={{ fontSize: '1.1em' }} />
          {displayName ?? path}
        </span>
      </Tooltip>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex cursor-pointer items-center rounded px-0.5 text-primary opacity-60 hover:bg-black/10 hover:opacity-100"
            aria-label={t('common.more')}>
            <Tooltip content={t('common.more')} delay={500}>
              <MoreHorizontal size={14} />
            </Tooltip>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="start">
          <MenuList>
            <MenuItem
              label={t('chat.input.tools.reveal_in_finder')}
              icon={<FolderOpen size={16} />}
              onClick={(e) => {
                e.stopPropagation()
                window.api.file.showInFolder(path).catch(() => {
                  window.toast.error(t('chat.input.tools.file_not_found', { path }))
                })
              }}
            />
            {availableEditors.length > 0 && <MenuDivider />}
            {availableEditors.map((app) => (
              <MenuItem
                key={app.id}
                label={app.name}
                icon={getEditorIcon(app)}
                onClick={(e) => {
                  e.stopPropagation()
                  openInEditor(app)
                }}
              />
            ))}
          </MenuList>
        </PopoverContent>
      </Popover>
    </span>
  )
})

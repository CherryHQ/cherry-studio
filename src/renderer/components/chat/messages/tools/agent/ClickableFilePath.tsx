import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import { FinderIcon } from '@renderer/components/Icons/SvgIcon'
import { isMac, isWin } from '@renderer/config/constant'
import { getEditorIcon } from '@renderer/utils/editorUtils'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { FolderOpen, MoreHorizontal } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions, useOptionalMessageListUi } from '../../MessageListProvider'
import { normalizeInlineFilePath } from '../../utils/filePath'

interface ClickableFilePathProps {
  path: string
  displayName?: string
}

// Workspace-relative paths can't be resolved without workspace context here,
// so existence validation only runs for absolute paths.
const isAbsoluteFilePath = (value: string): boolean => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)

export const ClickableFilePath = memo(function ClickableFilePath({ path, displayName }: ClickableFilePathProps) {
  const { t } = useTranslation()
  const normalizedPath = useMemo(() => normalizeInlineFilePath(path), [path])
  const iconName = useMemo(() => getFileIconName(normalizedPath), [normalizedPath])
  const ui = useOptionalMessageListUi()
  const actions = useOptionalMessageListActions()
  const openArtifactFile = actions?.openArtifactFile
  const showInFolder = actions?.showInFolder
  const openInExternalApp = actions?.openInExternalApp
  const notifyError = actions?.notifyError
  const availableEditors = ui?.externalCodeEditors ?? []
  const hasEditorActions = Boolean(openInExternalApp && availableEditors.length > 0)
  const hasMoreActions = Boolean(showInFolder) || hasEditorActions
  const fileManagerName = useMemo(() => {
    if (isMac) {
      return t('agent.session.file_manager.finder')
    }
    if (isWin) {
      return t('agent.session.file_manager.file_explorer')
    }
    return t('agent.session.file_manager.files')
  }, [t])

  const renderFileManagerIcon = () => (isMac ? <FinderIcon className="size-4" /> : <FolderOpen size={16} />)

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      Promise.resolve(openInExternalApp?.(app, normalizedPath)).catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: normalizedPath }))
      })
    },
    [normalizedPath, notifyError, openInExternalApp, t]
  )

  const handleOpen = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      if (!openArtifactFile) return
      e.stopPropagation()
      const run = async () => {
        if (isAbsoluteFilePath(normalizedPath)) {
          const status = await window.api.file.getPathStatus({ path: normalizedPath, expectedKind: 'file' })
          if (!status.ok) {
            notifyError?.(t('chat.input.tools.file_not_found', { path: normalizedPath }))
            return
          }
        }
        await openArtifactFile(normalizedPath)
      }
      run().catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: normalizedPath }))
      })
    },
    [normalizedPath, notifyError, openArtifactFile, t]
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
      <Tooltip content={normalizedPath} delay={500} classNames={{ placeholder: 'flex flex-row items-center' }}>
        <span
          role={openArtifactFile ? 'link' : undefined}
          tabIndex={openArtifactFile ? 0 : undefined}
          onClick={openArtifactFile ? handleOpen : undefined}
          onKeyDown={openArtifactFile ? handleKeyDown : undefined}
          className={`inline-flex items-center gap-1 ${openArtifactFile ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
          style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>
          <Icon icon={`material-icon-theme:${iconName}`} className="shrink-0" style={{ fontSize: '1.1em' }} />
          {displayName ?? normalizedPath}
        </span>
      </Tooltip>
      {hasMoreActions && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex cursor-pointer items-center rounded px-0.5 text-primary opacity-60 hover:bg-black/10 hover:opacity-100"
              aria-label={t('common.more')}>
              <Tooltip
                content={t('common.more')}
                delay={500}
                classNames={{ placeholder: 'flex flex-row items-center' }}>
                <MoreHorizontal size={14} />
              </Tooltip>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            <MenuList>
              {showInFolder && (
                <MenuItem
                  label={fileManagerName}
                  icon={renderFileManagerIcon()}
                  onClick={(e) => {
                    e.stopPropagation()
                    Promise.resolve(showInFolder(normalizedPath)).catch(() => {
                      notifyError?.(t('chat.input.tools.file_not_found', { path: normalizedPath }))
                    })
                  }}
                />
              )}
              {openInExternalApp &&
                availableEditors.map((app) => (
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
      )}
    </span>
  )
})

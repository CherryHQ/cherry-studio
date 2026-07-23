import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import { getEditorIcon } from '@renderer/components/icons/EditorIcon'
import { FinderIcon } from '@renderer/components/icons/SvgIcon'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/utils/filePath'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import { isMac, isWin } from '@renderer/utils/platform'
import type { ExternalAppInfo } from '@shared/types/externalApp'
import { FolderOpen, MoreHorizontal } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions, useOptionalMessageListUi } from '../../MessageListProvider'

interface ClickableFilePathProps {
  path: string
  displayName?: string
  interactive?: boolean
  /**
   * Explicit open handler. When provided it takes over the primary click
   * (receiving the resolved path) instead of the message-list actions — lets
   * surfaces without a `MessageListProvider` (e.g. the artifact file preview)
   * route the click to their own open logic. The "more actions" popover still
   * derives from the message-list context and is simply absent off-context.
   */
  onOpen?: (path: string) => void
}

export const ClickableFilePath = memo(function ClickableFilePath({
  path,
  displayName,
  interactive = true,
  onOpen
}: ClickableFilePathProps) {
  const { t } = useTranslation()
  const displayPath = useMemo(() => normalizeInlineFilePath(path), [path])
  const targetPath = useMemo(() => resolveInlineFilePath(path), [path])
  const iconName = useMemo(() => getFileIconName(displayPath), [displayPath])
  const ui = useOptionalMessageListUi()
  const actions = useOptionalMessageListActions()
  const openArtifactFile = interactive ? actions?.openArtifactFile : undefined
  const openPath = interactive ? actions?.openPath : undefined
  const isDirectory = interactive ? actions?.isDirectory : undefined
  const showInFolder = interactive ? actions?.showInFolder : undefined
  const openInExternalApp = interactive ? actions?.openInExternalApp : undefined
  const notifyError = actions?.notifyError
  const canOpen = Boolean(onOpen || openArtifactFile || openPath)
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
      Promise.resolve(openInExternalApp?.(app, targetPath)).catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [notifyError, openInExternalApp, t, targetPath]
  )

  const handleOpen = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      if (!canOpen) return
      e.stopPropagation()
      if (onOpen) {
        onOpen(targetPath)
        return
      }
      await openFileTarget(targetPath, {
        openArtifactFile,
        openPath,
        isDirectory,
        onError: () => notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [canOpen, onOpen, isDirectory, notifyError, openArtifactFile, openPath, t, targetPath]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        void handleOpen(e)
      }
    },
    [handleOpen]
  )

  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip content={displayPath} delay={500} classNames={{ placeholder: 'flex flex-row items-center' }}>
        <span
          role={canOpen ? 'link' : undefined}
          tabIndex={canOpen ? 0 : undefined}
          onClick={canOpen ? handleOpen : undefined}
          onKeyDown={canOpen ? handleKeyDown : undefined}
          className={`inline-flex items-center gap-1 break-all ${
            canOpen ? 'cursor-pointer text-primary hover:underline' : 'cursor-default text-foreground-secondary'
          }`}>
          <Icon icon={`material-icon-theme:${iconName}`} className="shrink-0" style={{ fontSize: '1.1em' }} />
          {displayName ?? displayPath}
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
                    Promise.resolve(showInFolder(targetPath)).catch(() => {
                      notifyError?.(t('chat.input.tools.file_not_found', { path: targetPath }))
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

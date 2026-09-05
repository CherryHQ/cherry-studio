import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import { getOpenTargetBadge, getOpenTargetLabel, OpenTargetIcon } from '@renderer/components/OpenTarget'
import { useExternalOpenTargets } from '@renderer/hooks/useExternalOpenTargets'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/utils/filePath'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { MoreHorizontal } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions } from '../../MessageListProvider'

interface ClickableFilePathProps {
  path: string
  displayName?: string
  interactive?: boolean
  preserveWrappingPunctuation?: boolean
}

export const ClickableFilePath = memo(function ClickableFilePath({
  path,
  displayName,
  interactive = true,
  preserveWrappingPunctuation = false
}: ClickableFilePathProps) {
  const { t } = useTranslation()
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const displayPath = useMemo(
    () => (preserveWrappingPunctuation ? path : normalizeInlineFilePath(path)),
    [path, preserveWrappingPunctuation]
  )
  const unresolvedTargetPath = useMemo(
    () => resolveInlineFilePath(path, { preserveWrappingPunctuation }),
    [path, preserveWrappingPunctuation]
  )
  const iconName = useMemo(() => getFileIconName(displayPath), [displayPath])
  const actions = useOptionalMessageListActions()
  const resolvePath = actions?.resolvePath
  const targetPath = useMemo(
    () => resolvePath?.(unresolvedTargetPath) ?? unresolvedTargetPath,
    [resolvePath, unresolvedTargetPath]
  )
  const openArtifactFile = interactive ? actions?.openArtifactFile : undefined
  const openPath = interactive ? actions?.openPath : undefined
  const isDirectory = interactive ? actions?.isDirectory : undefined
  const notifyError = actions?.notifyError
  const canOpen = Boolean(openArtifactFile || openPath)
  const hasAbsoluteTargetPath = AbsoluteFilePathSchema.safeParse(targetPath).success
  const { isLoading, targets, openTarget } = useExternalOpenTargets(targetPath, 'file', {
    enabled: canOpen && hasAbsoluteTargetPath && actionsMenuOpen
  })
  const hasMoreActions = canOpen && hasAbsoluteTargetPath

  const handleOpenTarget = useCallback(
    (target: ExternalOpenTarget) => {
      void openTarget(target).catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [notifyError, openTarget, t, targetPath]
  )

  const handleOpen = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      if (!canOpen) return
      e.stopPropagation()
      await openFileTarget(targetPath, {
        openArtifactFile,
        openPath,
        isDirectory,
        onError: () => notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [canOpen, isDirectory, notifyError, openArtifactFile, openPath, t, targetPath]
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
            canOpen ? 'cursor-pointer text-link hover:underline' : 'cursor-default text-muted-foreground'
          }`}>
          <Icon icon={`material-icon-theme:${iconName}`} className="shrink-0" style={{ fontSize: '1.1em' }} />
          {displayName ?? displayPath}
        </span>
      </Tooltip>
      {hasMoreActions && (
        <Popover open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex cursor-pointer items-center rounded px-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
              {isLoading && targets.length === 0 && <MenuItem label={t('common.loading')} disabled />}
              {targets.map((target) => (
                <MenuItem
                  key={target.id}
                  label={getOpenTargetLabel(target, t)}
                  icon={<OpenTargetIcon target={target} />}
                  suffix={getOpenTargetBadge(target, t)}
                  onClick={(e) => {
                    e.stopPropagation()
                    setActionsMenuOpen(false)
                    handleOpenTarget(target)
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

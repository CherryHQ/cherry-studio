import {
  Button,
  ButtonGroup,
  MenuItem,
  MenuList,
  NormalTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { getEditorIcon } from '@renderer/components/icons/EditorIcon'
import { FinderIcon } from '@renderer/components/icons/SvgIcon'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { toast } from '@renderer/services/toast'
import { buildEditorUrl } from '@renderer/utils/editor'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { joinPath } from '@renderer/utils/path'
import { isMac, isWin } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import type { ExternalAppId, ExternalAppInfo } from '@shared/types/externalApp'
import { ChevronDown, FileText, FolderOpen } from 'lucide-react'
import { type ReactNode, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const FILE_MANAGER_TARGET = 'file_manager' as const
const TOOLBAR_BUTTON_CLASS = 'text-muted-foreground hover:bg-accent hover:text-foreground'
const SPLIT_BUTTON_GROUP_CLASS = 'h-8 overflow-hidden rounded-md border border-border-subtle'
const SPLIT_BUTTON_CLASS = 'h-full rounded-none p-0'

type OpenExternalAppButtonProps = {
  workdir: string
  filePath?: string | null
  menuTrigger?: ReactNode
  tooltip?: string
  className?: string
}

type OpenTarget = ExternalAppId | typeof FILE_MANAGER_TARGET

const OpenExternalAppButton = ({ workdir, filePath, menuTrigger, tooltip, className }: OpenExternalAppButtonProps) => {
  const { t } = useTranslation()
  const fileTargetPath = filePath ? joinPath(workdir, filePath) : null
  const openTargetPath = fileTargetPath ?? workdir
  const { data: externalApps } = useExternalApps({ enabled: true })
  const [lastUsedTarget, setLastUsedTarget] = usePersistCache('agent.open_external_app.last_used_target')

  const availableEditors = useMemo(() => {
    if (!externalApps) {
      return []
    }
    return externalApps.filter((app) => app.tags.includes('code-editor'))
  }, [externalApps])

  const fileManagerName = useMemo(() => {
    if (isMac) {
      return t('agent.session.file_manager.finder')
    }
    if (isWin) {
      return t('agent.session.file_manager.file_explorer')
    }
    return t('agent.session.file_manager.files')
  }, [t])

  const selectedTarget = useMemo<OpenTarget>(() => {
    if (lastUsedTarget === FILE_MANAGER_TARGET) {
      return FILE_MANAGER_TARGET
    }
    if (lastUsedTarget && availableEditors.some((app) => app.id === lastUsedTarget)) {
      return lastUsedTarget
    }
    return availableEditors[0]?.id ?? FILE_MANAGER_TARGET
  }, [availableEditors, lastUsedTarget])

  const selectedEditor = useMemo(() => {
    if (selectedTarget === FILE_MANAGER_TARGET) {
      return undefined
    }
    return availableEditors.find((app) => app.id === selectedTarget)
  }, [availableEditors, selectedTarget])

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      window.open(buildEditorUrl(app, openTargetPath))
      setLastUsedTarget(app.id)
    },
    [openTargetPath, setLastUsedTarget]
  )

  const openFileManager = useCallback(async () => {
    try {
      if (fileTargetPath) {
        await window.api.file.showInFolder(fileTargetPath)
      } else {
        await window.api.file.openPath(workdir)
      }
      setLastUsedTarget(FILE_MANAGER_TARGET)
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: openTargetPath })))
    }
  }, [fileTargetPath, openTargetPath, setLastUsedTarget, t, workdir])

  const openFileWithDefaultApp = useCallback(async () => {
    if (!fileTargetPath) return
    try {
      await window.api.file.openPath(fileTargetPath)
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: fileTargetPath })))
    }
  }, [fileTargetPath, t])

  const handlePrimaryClick = useCallback(() => {
    if (selectedEditor) {
      openInEditor(selectedEditor)
      return
    }
    void openFileManager()
  }, [openFileManager, openInEditor, selectedEditor])

  const renderFileManagerIcon = () => (isMac ? <FinderIcon className="size-4" /> : <FolderOpen size={16} />)

  const selectedName = selectedEditor?.name ?? fileManagerName
  const primaryIcon = selectedEditor ? getEditorIcon(selectedEditor) : renderFileManagerIcon()
  const primaryLabel = t('common.open_in', { name: selectedName })
  const primaryTooltip = tooltip ?? primaryLabel
  const defaultAppName = t('agent.preview_pane.default_app')
  const hasAlternativeTargets = Boolean(fileTargetPath) || availableEditors.length > 0
  const menu = (
    <PopoverContent className="w-56 p-1" align={menuTrigger ? 'start' : 'end'}>
      <MenuList>
        {fileTargetPath && (
          <MenuItem
            label={defaultAppName}
            icon={<FileText size={16} />}
            onClick={() => void openFileWithDefaultApp()}
          />
        )}
        <MenuItem
          label={fileManagerName}
          icon={renderFileManagerIcon()}
          active={selectedTarget === FILE_MANAGER_TARGET}
          onClick={() => void openFileManager()}
        />
        {availableEditors.map((app) => (
          <MenuItem
            key={app.id}
            label={app.name}
            icon={getEditorIcon(app)}
            active={selectedTarget === app.id}
            onClick={() => openInEditor(app)}
          />
        ))}
      </MenuList>
    </PopoverContent>
  )

  if (menuTrigger) {
    const trigger = <PopoverTrigger asChild>{menuTrigger}</PopoverTrigger>
    return (
      <Popover>
        {tooltip ? <NormalTooltip content={tooltip}>{trigger}</NormalTooltip> : trigger}
        {menu}
      </Popover>
    )
  }

  if (!hasAlternativeTargets) {
    return (
      <NormalTooltip content={primaryTooltip} delayDuration={500}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={[TOOLBAR_BUTTON_CLASS, className].filter(Boolean).join(' ')}
          aria-label={primaryLabel}
          onClick={handlePrimaryClick}>
          {primaryIcon}
        </Button>
      </NormalTooltip>
    )
  }

  return (
    <ButtonGroup attached={false} className={cn(SPLIT_BUTTON_GROUP_CLASS, 'gap-0', className)}>
      <NormalTooltip content={primaryTooltip} delayDuration={500}>
        <Button
          type="button"
          className={`w-8 min-w-8 ${SPLIT_BUTTON_CLASS} ${TOOLBAR_BUTTON_CLASS}`}
          variant="ghost"
          size="icon-sm"
          aria-label={primaryLabel}
          onClick={handlePrimaryClick}>
          {primaryIcon}
        </Button>
      </NormalTooltip>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            className={`w-6 min-w-6 ${SPLIT_BUTTON_CLASS} ${TOOLBAR_BUTTON_CLASS}`}
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.more')}>
            <ChevronDown size={14} />
          </Button>
        </PopoverTrigger>
        {menu}
      </Popover>
    </ButtonGroup>
  )
}

export default OpenExternalAppButton

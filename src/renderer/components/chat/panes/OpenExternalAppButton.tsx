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
import { FinderIcon } from '@renderer/components/Icons/SvgIcon'
import { isMac, isWin } from '@renderer/config/constant'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { buildEditorUrl, getEditorIcon } from '@renderer/utils/editorUtils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { joinPath } from '@renderer/utils/path'
import type { ExternalAppId, ExternalAppInfo } from '@shared/types/externalApp'
import { ChevronDown, FileText, FolderOpen } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const FILE_MANAGER_TARGET = 'file_manager' as const
const TOOLBAR_BUTTON_CLASS = 'text-muted-foreground hover:bg-accent hover:text-foreground'

type OpenExternalAppButtonProps = {
  workdir: string
  filePath?: string | null
  className?: string
}

type OpenTarget = ExternalAppId | typeof FILE_MANAGER_TARGET

const OpenExternalAppButton = ({ workdir, filePath, className }: OpenExternalAppButtonProps) => {
  const { t } = useTranslation()
  const fileTargetPath = filePath ? joinPath(workdir, filePath) : null
  const { data: externalApps } = useExternalApps({ enabled: !fileTargetPath })
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
      window.open(buildEditorUrl(app, workdir))
      setLastUsedTarget(app.id)
    },
    [setLastUsedTarget, workdir]
  )

  const openFileManager = useCallback(async () => {
    try {
      await window.api.file.openPath(workdir)
      setLastUsedTarget(FILE_MANAGER_TARGET)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: workdir })))
    }
  }, [setLastUsedTarget, t, workdir])

  const revealFileTarget = useCallback(async () => {
    if (!fileTargetPath) return
    try {
      await window.api.file.showInFolder(fileTargetPath)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: fileTargetPath })))
    }
  }, [fileTargetPath, t])

  const openFileWithDefaultApp = useCallback(async () => {
    if (!fileTargetPath) return
    try {
      await window.api.file.openPath(fileTargetPath)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: fileTargetPath })))
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

  if (fileTargetPath) {
    const defaultAppName = t('agent.preview_pane.default_app')
    const primaryLabel = t('common.open_in', { name: defaultAppName })

    return (
      <ButtonGroup className={className}>
        <NormalTooltip content={primaryLabel} delayDuration={500}>
          <Button
            type="button"
            className={`h-7 w-8 min-w-8 border-r-0 p-0 ${TOOLBAR_BUTTON_CLASS}`}
            variant="ghost"
            size="icon-sm"
            aria-label={primaryLabel}
            onClick={() => void openFileWithDefaultApp()}>
            <FileText size={16} />
          </Button>
        </NormalTooltip>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              className={`h-7 w-6 min-w-6 p-0 ${TOOLBAR_BUTTON_CLASS}`}
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.more')}>
              <ChevronDown size={14} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="end">
            <MenuList>
              <MenuItem
                label={defaultAppName}
                icon={<FileText size={16} />}
                onClick={() => void openFileWithDefaultApp()}
              />
              <MenuItem
                label={fileManagerName}
                icon={renderFileManagerIcon()}
                onClick={() => void revealFileTarget()}
              />
            </MenuList>
          </PopoverContent>
        </Popover>
      </ButtonGroup>
    )
  }

  const selectedName = selectedEditor?.name ?? fileManagerName
  const primaryIcon = selectedEditor ? getEditorIcon(selectedEditor) : renderFileManagerIcon()
  const primaryLabel = t('common.open_in', { name: selectedName })

  if (availableEditors.length === 0) {
    return (
      <NormalTooltip content={primaryLabel} delayDuration={500}>
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
    <ButtonGroup className={className}>
      <NormalTooltip content={primaryLabel} delayDuration={500}>
        <Button
          type="button"
          className={`h-7 w-8 min-w-8 border-r-0 p-0 ${TOOLBAR_BUTTON_CLASS}`}
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
            className={`h-7 w-6 min-w-6 p-0 ${TOOLBAR_BUTTON_CLASS}`}
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.more')}>
            <ChevronDown size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="end">
          <MenuList>
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
      </Popover>
    </ButtonGroup>
  )
}

export default OpenExternalAppButton

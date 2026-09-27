import { FolderOpen } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useFilesystemMcpBaseDir } from '@renderer/hooks/useFilesystemMcpBaseDir'

/**
 * Toolbar button for selecting the working folder in the agent coding screen.
 * Updates the @cherry/filesystem MCP server's baseDir without leaving the chat.
 */
export const AgentWorkspaceFolderPickerButton = () => {
  const { t } = useTranslation()
  const { baseDir, updateBaseDir, filesystemServer } = useFilesystemMcpBaseDir()
  const [isOpen, setIsOpen] = useState(false)

  const handleBrowse = useCallback(async () => {
    const result = await window.api.select({ properties: ['openDirectory'] })
    if (!result.canceled && result.filePaths.length > 0) {
      await updateBaseDir(result.filePaths[0])
      setIsOpen(false)
    }
  }, [updateBaseDir])

  if (!filesystemServer) {
    return null
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent hover:bg-accent hover:text-accent-foreground"
          aria-label={t('agent.session.workspace_selector.placeholder')}
          title={t('agent.session.workspace_selector.placeholder')}>
          <FolderOpen className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium text-sm">{t('settings.mcp.filesystem.baseDir')}</h4>
            <p className="text-foreground-secondary text-xs">{t('settings.mcp.filesystem.baseDirPlaceholder')}</p>
          </div>
          <div className="space-y-2">
            {baseDir && (
              <div className="flex items-center gap-2 rounded border border-border bg-background-secondary p-2">
                <FolderOpen className="h-4 w-4 shrink-0 text-foreground-secondary" />
                <div className="min-w-0 flex-1 truncate text-xs text-foreground-secondary">{baseDir}</div>
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleBrowse()}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
              {t('common.browse')}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

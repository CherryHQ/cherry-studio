import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

const logger = loggerService.withContext('WorkspaceEditDialog')

export function WorkspaceEditDialog({ workspace, onClose }: { workspace: AgentWorkspaceEntity; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(workspace.name)
  const [mainDirectory, setMainDirectory] = useState(workspace.path)
  const [directories, setDirectories] = useState([workspace.path, ...workspace.additionalDirectories])
  const [isSelecting, setIsSelecting] = useState(false)
  const { trigger: updateWorkspace, isLoading } = useMutation('PATCH', '/agent-workspaces/:workspaceId', {
    refresh: ['/agent-workspaces', '/agent-sessions']
  })

  const addDirectory = async () => {
    setIsSelecting(true)
    try {
      const directory = await window.api.file.selectFolder({ properties: ['openDirectory', 'createDirectory'] })
      if (directory) setDirectories((current) => (current.includes(directory) ? current : [...current, directory]))
    } catch (error) {
      logger.error('Failed to select workspace directory', error as Error)
      toast.error(t('agent.session.workspace_selector.select_failed'))
    } finally {
      setIsSelecting(false)
    }
  }

  const save = async () => {
    if (!name.trim() || isLoading || isSelecting) return
    try {
      await updateWorkspace({
        params: { workspaceId: workspace.id },
        body: {
          name: name.trim(),
          path: mainDirectory,
          additionalDirectories: directories.filter((directory) => directory !== mainDirectory)
        }
      })
      onClose()
    } catch (error) {
      logger.error('Failed to update workspace', error as Error)
      toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isLoading && !isSelecting) onClose()
      }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('agent.session.workspace_edit.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-name">{t('common.name')}</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {directories.map((directory) => (
              <div key={directory} className="flex items-center gap-2 rounded-md border p-2">
                <span className="min-w-0 flex-1 break-all text-sm">{directory}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLoading || directory === mainDirectory}
                  onClick={() => setMainDirectory(directory)}>
                  {t(
                    directory === mainDirectory
                      ? 'agent.session.workspace_edit.main_directory'
                      : 'agent.session.workspace_edit.set_main'
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLoading || directory === mainDirectory}
                  onClick={() => setDirectories((current) => current.filter((item) => item !== directory))}>
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" disabled={isLoading || isSelecting} onClick={() => void addDirectory()}>
            {t('agent.session.workspace_selector.create_new')}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={isLoading || isSelecting} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!name.trim() || isLoading || isSelecting} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

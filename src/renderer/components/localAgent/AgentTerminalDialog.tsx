import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import type { TerminalConfig } from '@shared/types/codeCli'

import { TerminalConfigPanel } from './TerminalConfigPanel'

export interface AgentTerminalDialogProps {
  open: boolean
  onClose: () => void
  toolName: string
  directory?: string
  directoryHistory?: string[]
  onSelectDirectory?: (directory: string) => void
  onRemoveDirectory?: (directory: string) => void
  terminals: TerminalConfig[]
  selectedTerminal: string | undefined
  onSelectFolder: () => void
  onSelectTerminal: (terminal: string) => void
  onLaunch: () => void
  launching: boolean
}

export const AgentTerminalDialog: FC<AgentTerminalDialogProps> = ({
  open,
  onClose,
  toolName,
  directory,
  directoryHistory,
  onSelectDirectory,
  onRemoveDirectory,
  terminals,
  selectedTerminal,
  onSelectFolder,
  onSelectTerminal,
  onLaunch,
  launching
}) => {
  const { t } = useTranslation()
  const canLaunch = !!directory

  return (
    <Dialog open={open} onOpenChange={(o) => (!o && !launching ? onClose() : undefined)}>
      <DialogContent size="default" aria-describedby={undefined} className="flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('code.launch.title', { tool: toolName })}</DialogTitle>
        </DialogHeader>

        <TerminalConfigPanel
          disabled={launching}
          directory={directory}
          directoryHistory={directoryHistory}
          onSelectDirectory={onSelectDirectory}
          onRemoveDirectory={onRemoveDirectory}
          terminals={terminals}
          selectedTerminal={selectedTerminal}
          onSelectFolder={onSelectFolder}
          onSelectTerminal={onSelectTerminal}
        />

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={launching}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={onLaunch} disabled={!canLaunch || launching} loading={launching}>
            {t('code.launch.label')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

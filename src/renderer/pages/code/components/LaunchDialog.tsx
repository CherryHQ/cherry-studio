import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import type { InlineErrorDetailInput } from '@renderer/services/AppErrorDetailService'
import type { TerminalConfig } from '@shared/types/codeCli'

import { CurrentConfigPanel } from './CurrentConfigPanel'

export interface LaunchDialogProps {
  open: boolean
  onClose: () => void
  toolName: string
  directory?: string
  terminals: TerminalConfig[]
  selectedTerminal: string | undefined
  onSelectFolder: () => void
  onSelectTerminal: (terminal: string) => void
  onLaunch: () => void
  launching: boolean
  /** The last launch failure, shown in the dialog while it stays open for a retry. */
  failure?: InlineErrorDetailInput | null
}

export const LaunchDialog: FC<LaunchDialogProps> = ({
  open,
  onClose,
  toolName,
  directory,
  terminals,
  selectedTerminal,
  onSelectFolder,
  onSelectTerminal,
  onLaunch,
  launching,
  failure
}) => {
  const { t } = useTranslation()
  const canLaunch = !!directory

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent size="default" aria-describedby={undefined} className="flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('code.launch.title', { tool: toolName })}</DialogTitle>
        </DialogHeader>

        <CurrentConfigPanel
          directory={directory}
          terminals={terminals}
          selectedTerminal={selectedTerminal}
          onSelectFolder={onSelectFolder}
          onSelectTerminal={onSelectTerminal}
        />

        {failure ? (
          <ErrorNotice variant="inline" title={t('code.launch.error')} detail={<ErrorDetailAction {...failure} />} />
        ) : null}

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

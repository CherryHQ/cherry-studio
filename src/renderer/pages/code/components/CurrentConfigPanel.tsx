import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { isMac, isWin } from '@renderer/utils/platform'
import type { TerminalConfig } from '@shared/types/codeCli'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface CurrentConfigPanelProps {
  directory?: string
  terminals: TerminalConfig[]
  selectedTerminal: string | undefined
  onSelectFolder: () => void
  onSelectTerminal: (terminal: string) => void
}

/** Current provider's working-directory + terminal picker. */
export const CurrentConfigPanel: FC<CurrentConfigPanelProps> = ({
  directory,
  terminals,
  selectedTerminal,
  onSelectFolder,
  onSelectTerminal
}) => {
  const { t } = useTranslation()
  const showTerminals = (isMac || isWin) && terminals.length > 0
  // The caller already resolves `selectedTerminal` to the same fallback used for
  // launching (see useLaunchDialogController), so display and launch stay in sync.
  const effectiveTerminal = selectedTerminal ?? ''

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-foreground/70 text-xs">{t('code.working_directory')}</label>
        <div className="flex w-full items-center">
          <Input value={directory ?? ''} placeholder={t('code.folder_placeholder')} readOnly tabIndex={-1} />
          <Button variant="default" onClick={onSelectFolder} className="ml-2 shrink-0">
            <FolderOpen size={16} />
            {t('code.select_folder')}
          </Button>
        </div>
      </div>

      {showTerminals && (
        <div className="space-y-1.5">
          <label className="text-foreground/70 text-xs">{t('code.terminal')}</label>
          <Select value={effectiveTerminal} onValueChange={(value) => onSelectTerminal(value)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {terminals.map((terminal) => (
                <SelectItem key={terminal.id} value={terminal.id}>
                  {terminal.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

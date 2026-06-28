import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { isMac, isWin } from '@renderer/utils/platform'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import type { TerminalConfig } from '@shared/types/codeCli'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface CurrentConfigPanelProps {
  config: CliNamedConfig
  terminals: TerminalConfig[]
  selectedTerminal: string | undefined
  onSelectFolder: () => void
  onSelectTerminal: (terminal: string) => void
}

/** Current-config working-directory + terminal picker + launch affordance. */
export const CurrentConfigPanel: FC<CurrentConfigPanelProps> = ({
  config,
  terminals,
  selectedTerminal,
  onSelectFolder,
  onSelectTerminal
}) => {
  const { t } = useTranslation()
  const showTerminals = (isMac || isWin) && terminals.length > 0
  // Prefer the persisted terminal; fall back to the first available one so the
  // picker never shows a blank value before the user makes a choice.
  const effectiveTerminal = selectedTerminal ?? terminals[0]?.id ?? ''

  return (
    <div className="space-y-3 border-border/15 border-t pt-4">
      <div className="space-y-1.5">
        <label className="text-foreground/70 text-xs">{t('code.working_directory')}</label>
        <div className="flex w-full items-center">
          <Input value={config.directory ?? ''} placeholder={t('code.folder_placeholder')} readOnly tabIndex={-1} />
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

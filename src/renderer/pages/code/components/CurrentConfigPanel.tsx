import { Button } from '@cherrystudio/ui'
import { isMac, isWin } from '@renderer/config/constant'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import type { TerminalConfig } from '@shared/types/codeCli'
import { Play } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface CurrentConfigPanelProps {
  config: CliNamedConfig
  directories: string[]
  terminals: TerminalConfig[]
  selectedTerminal: string | undefined
  onSelectFolder: () => void
  onSelectDirectory: (directory: string) => void
  onSelectTerminal: (terminal: string) => void
  onLaunch: () => void
}

/** Current-config working-directory + terminal picker + launch affordance. */
export const CurrentConfigPanel: FC<CurrentConfigPanelProps> = ({
  config,
  directories,
  terminals,
  selectedTerminal,
  onSelectFolder,
  onSelectDirectory,
  onSelectTerminal,
  onLaunch
}) => {
  const { t } = useTranslation()
  const showTerminals = (isMac || isWin) && terminals.length > 0

  return (
    <div className="space-y-3 border-border/15 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-muted-foreground text-xs">{t('code.current_config_settings')}</div>
        <Button variant="default" size="sm" onClick={onLaunch} disabled={!config.directory} className="gap-1 text-xs">
          <Play size={12} />
          {t('code.launch.label')}
        </Button>
      </div>

      <div className="space-y-1.5">
        <label className="text-foreground/70 text-xs">{t('code.working_directory')}</label>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-md border border-border-muted bg-muted/30 px-3 py-2 font-mono text-foreground text-xs">
            {config.directory || t('code.folder_placeholder')}
          </div>
          <Button variant="secondary" size="lg" onClick={onSelectFolder} className="shrink-0">
            {t('code.select_folder')}
          </Button>
        </div>
        {directories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {directories.map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => onSelectDirectory(dir)}
                className="max-w-50 truncate rounded border border-border/40 bg-muted/20 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                title={dir}>
                {dir}
              </button>
            ))}
          </div>
        )}
      </div>

      {showTerminals && (
        <div className="space-y-1.5">
          <label className="text-foreground/70 text-xs">{t('code.terminal')}</label>
          <select
            value={selectedTerminal ?? ''}
            onChange={(e) => onSelectTerminal(e.target.value)}
            className="w-full rounded-md border border-border-muted bg-muted/30 px-3 py-2 text-foreground text-sm">
            {terminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id}>
                {terminal.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

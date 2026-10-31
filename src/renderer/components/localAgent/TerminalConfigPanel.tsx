import { Check, ChevronDown, FolderOpen, X } from 'lucide-react'
import { type FC, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { isMac, isWin } from '@renderer/utils/platform'
import type { TerminalConfig } from '@shared/types/codeCli'

export interface TerminalConfigPanelProps {
  disabled?: boolean
  directory?: string
  directoryHistory?: string[]
  onSelectDirectory?: (directory: string) => void
  onRemoveDirectory?: (directory: string) => void
  terminals: TerminalConfig[]
  selectedTerminal: string | undefined
  onSelectFolder: () => void
  onSelectTerminal: (terminal: string) => void
}

/** Current provider's working-directory + terminal picker. */
export const TerminalConfigPanel: FC<TerminalConfigPanelProps> = ({
  disabled = false,
  directory,
  directoryHistory = [],
  onSelectDirectory,
  onRemoveDirectory,
  terminals,
  selectedTerminal,
  onSelectFolder,
  onSelectTerminal
}) => {
  const { t } = useTranslation()
  const [historyOpen, setHistoryOpen] = useState(false)
  const directoryId = useId()
  const showTerminals = (isMac || isWin) && terminals.length > 0
  // The caller already resolves `selectedTerminal` to the same fallback used for
  // launching (see useLaunchDialogController), so display and launch stay in sync.
  const effectiveTerminal = selectedTerminal ?? ''

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={directoryId} className="text-xs text-muted-foreground">
          {t('code.working_directory')}
        </label>
        <div className="flex w-full items-center">
          <Popover open={historyOpen && directoryHistory.length > 0} onOpenChange={setHistoryOpen}>
            <PopoverAnchor asChild>
              <InputGroup>
                <InputGroupInput
                  id={directoryId}
                  value={directory ?? ''}
                  placeholder={t('code.folder_placeholder')}
                  readOnly
                  disabled={disabled}
                />
                {directoryHistory.length > 0 && onSelectDirectory && onRemoveDirectory && (
                  <InputGroupAddon align="inline-end">
                    <Tooltip content={t('code.directory_history')}>
                      <PopoverTrigger asChild>
                        <InputGroupButton size="icon-xs" aria-label={t('code.directory_history')} disabled={disabled}>
                          <ChevronDown size={16} />
                        </InputGroupButton>
                      </PopoverTrigger>
                    </Tooltip>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </PopoverAnchor>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-1">
              <Scrollbar className="max-h-60" aria-label={t('code.directory_history')}>
                {directoryHistory.map((path) => (
                  <div key={path} className="flex min-w-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      className="min-w-0 flex-1 justify-start font-normal"
                      aria-pressed={directory === path}
                      onClick={() => {
                        onSelectDirectory?.(path)
                        setHistoryOpen(false)
                      }}>
                      <span className="min-w-0 flex-1 truncate text-left" title={path}>
                        {path}
                      </span>
                      {directory === path && <Check size={14} />}
                    </Button>
                    <Tooltip content={t('code.directory_history.remove')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t('code.directory_history.remove')} ${path}`}
                        onClick={() => onRemoveDirectory?.(path)}>
                        <X size={14} />
                      </Button>
                    </Tooltip>
                  </div>
                ))}
              </Scrollbar>
            </PopoverContent>
          </Popover>
          <Button variant="default" onClick={onSelectFolder} className="ml-2 shrink-0" disabled={disabled}>
            <FolderOpen size={16} />
            {t('code.select_folder')}
          </Button>
        </div>
      </div>

      {showTerminals && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{t('code.terminal')}</label>
          <Select value={effectiveTerminal} onValueChange={(value) => onSelectTerminal(value)} disabled={disabled}>
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

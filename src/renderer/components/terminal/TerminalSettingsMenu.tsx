import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'

const SETTING_KEYS = {
  cursorStyle: 'feature.agent.terminal.cursor_style',
  cursorBlink: 'feature.agent.terminal.cursor_blink'
} as const
const CURSOR_STYLES = ['block', 'bar', 'underline'] as const
const CURSOR_LABELS = {
  block: 'terminal.settings.block',
  bar: 'terminal.settings.bar',
  underline: 'terminal.settings.underline'
} as const

export function useTerminalSettings() {
  return useMultiplePreferences(SETTING_KEYS)
}

export function TerminalSettingsMenu() {
  const { t } = useTranslation()
  const [settings, setSettings] = useTerminalSettings()

  return (
    <DropdownMenu>
      <Tooltip content={t('terminal.settings.title')} delay={800}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('terminal.settings.title')}>
            <MoreHorizontal size={16} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t('terminal.settings.cursor_style')}
            <span className="ml-auto pl-4 text-muted-foreground">{t(CURSOR_LABELS[settings.cursorStyle])}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={settings.cursorStyle}
                onValueChange={(value) => {
                  const style = CURSOR_STYLES.find((style) => style === value)
                  if (style) void setSettings({ cursorStyle: style })
                }}>
                {CURSOR_STYLES.map((style) => (
                  <DropdownMenuRadioItem key={style} value={style}>
                    {t(CURSOR_LABELS[style])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          checked={settings.cursorBlink}
          onCheckedChange={(checked) => void setSettings({ cursorBlink: checked === true })}
          onSelect={(event) => event.preventDefault()}>
          {t('terminal.settings.cursor_blink')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

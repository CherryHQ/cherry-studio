import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
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

export function TerminalContextMenu({
  children,
  actions,
  onCloseAutoFocus
}: {
  children: ReactElement
  actions?: ReactNode
  onCloseAutoFocus?: ComponentProps<typeof ContextMenuContent>['onCloseAutoFocus']
}) {
  const { t } = useTranslation()
  const [settings, setSettings] = useTerminalSettings()

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-56"
        aria-label={t('terminal.settings.title')}
        onCloseAutoFocus={onCloseAutoFocus}>
        {actions && (
          <>
            {actions}
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            {t('terminal.settings.cursor_style')}
            <span className="ml-auto pl-4 text-muted-foreground">{t(CURSOR_LABELS[settings.cursorStyle])}</span>
          </ContextMenuSubTrigger>
          <ContextMenuPortal>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={settings.cursorStyle}
                onValueChange={(value) => {
                  const style = CURSOR_STYLES.find((style) => style === value)
                  if (style) void setSettings({ cursorStyle: style })
                }}>
                {CURSOR_STYLES.map((style) => (
                  <ContextMenuRadioItem key={style} value={style}>
                    {t(CURSOR_LABELS[style])}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuPortal>
        </ContextMenuSub>
        <ContextMenuCheckboxItem
          checked={settings.cursorBlink}
          onCheckedChange={(checked) => void setSettings({ cursorBlink: checked === true })}
          onSelect={(event) => event.preventDefault()}>
          {t('terminal.settings.cursor_blink')}
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

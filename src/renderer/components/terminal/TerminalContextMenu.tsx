import { MoreHorizontal } from 'lucide-react'
import type { ComponentProps, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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

export type TerminalMenuAction = { label: string; disabled?: boolean; onSelect: () => void }
type TerminalMenuProps = {
  actions?: TerminalMenuAction[]
  onCloseAutoFocus?: ComponentProps<typeof ContextMenuContent>['onCloseAutoFocus']
}

export function TerminalContextMenu({
  children,
  actions,
  onCloseAutoFocus
}: TerminalMenuProps & { children: ReactElement }) {
  const { t } = useTranslation()

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-56"
        aria-label={t('terminal.settings.title')}
        onCloseAutoFocus={onCloseAutoFocus}>
        <TerminalMenuItems kind="context" actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function TerminalDropdownMenu({ actions, onCloseAutoFocus }: TerminalMenuProps) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <Tooltip content={t('common.more')}>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t('common.more')} className="shrink-0">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={onCloseAutoFocus}>
        <TerminalMenuItems kind="dropdown" actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TerminalMenuItems({ kind, actions }: Pick<TerminalMenuProps, 'actions'> & { kind: 'context' | 'dropdown' }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useTerminalSettings()
  const Menu =
    kind === 'context'
      ? {
          Item: ContextMenuItem,
          Separator: ContextMenuSeparator,
          Sub: ContextMenuSub,
          SubTrigger: ContextMenuSubTrigger,
          Portal: ContextMenuPortal,
          SubContent: ContextMenuSubContent,
          RadioGroup: ContextMenuRadioGroup,
          RadioItem: ContextMenuRadioItem,
          CheckboxItem: ContextMenuCheckboxItem
        }
      : {
          Item: DropdownMenuItem,
          Separator: DropdownMenuSeparator,
          Sub: DropdownMenuSub,
          SubTrigger: DropdownMenuSubTrigger,
          Portal: DropdownMenuPortal,
          SubContent: DropdownMenuSubContent,
          RadioGroup: DropdownMenuRadioGroup,
          RadioItem: DropdownMenuRadioItem,
          CheckboxItem: DropdownMenuCheckboxItem
        }
  return (
    <>
      {actions && (
        <>
          {actions.map((action) => (
            <Menu.Item key={action.label} disabled={action.disabled} onSelect={action.onSelect}>
              {action.label}
            </Menu.Item>
          ))}
          <Menu.Separator />
        </>
      )}
      <Menu.Sub>
        <Menu.SubTrigger>
          {t('terminal.settings.cursor_style')}
          <span className="ml-auto pl-4 text-muted-foreground">{t(CURSOR_LABELS[settings.cursorStyle])}</span>
        </Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent>
            <Menu.RadioGroup
              value={settings.cursorStyle}
              onValueChange={(value) => {
                const style = CURSOR_STYLES.find((style) => style === value)
                if (style) void setSettings({ cursorStyle: style })
              }}>
              {CURSOR_STYLES.map((style) => (
                <Menu.RadioItem key={style} value={style}>
                  {t(CURSOR_LABELS[style])}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
      <Menu.CheckboxItem
        checked={settings.cursorBlink}
        onCheckedChange={(checked) => void setSettings({ cursorBlink: checked === true })}
        onSelect={(event) => event.preventDefault()}>
        {t('terminal.settings.cursor_blink')}
      </Menu.CheckboxItem>
    </>
  )
}

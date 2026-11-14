import { MoreHorizontal } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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

export const FILE_PANE_SETTING_KEYS = {
  treePosition: 'feature.agent.file_pane.tree_position',
  autoSave: 'feature.agent.file_pane.auto_save',
  tabIndent: 'feature.agent.file_pane.tab_indent',
  wordWrap: 'feature.agent.file_pane.word_wrap',
  indentGuides: 'feature.agent.file_pane.indent_guides',
  showWhitespace: 'feature.agent.file_pane.show_whitespace',
  scrollPastEnd: 'feature.agent.file_pane.scroll_past_end',
  tabSize: 'feature.agent.file_pane.tab_size'
} as const

const TAB_SIZES = [2, 4, 8]

type ToggleKey = 'autoSave' | 'tabIndent' | 'wordWrap' | 'indentGuides' | 'showWhitespace' | 'scrollPastEnd'
const TOGGLE_GROUPS: ReadonlyArray<ReadonlyArray<{ key: ToggleKey; label: string }>> = [
  [
    { key: 'autoSave', label: 'agent.preview_pane.settings.auto_save' },
    { key: 'tabIndent', label: 'agent.preview_pane.settings.tab_indent' }
  ],
  [
    { key: 'wordWrap', label: 'agent.preview_pane.settings.word_wrap' },
    { key: 'indentGuides', label: 'agent.preview_pane.settings.indent_guides' },
    { key: 'showWhitespace', label: 'agent.preview_pane.settings.show_whitespace' },
    { key: 'scrollPastEnd', label: 'agent.preview_pane.settings.scroll_past_end' }
  ]
]

export function useFilePaneSettings() {
  return useMultiplePreferences(FILE_PANE_SETTING_KEYS)
}

export function ArtifactPaneSettingsMenu({
  buttonClassName,
  wordWrapUnavailable = false
}: {
  buttonClassName?: string
  /** The open file has a line too long to wrap, so the editor shows it unwrapped regardless. */
  wordWrapUnavailable?: boolean
}) {
  const { t } = useTranslation()
  const [settings, setSettings] = useFilePaneSettings()

  return (
    <DropdownMenu>
      <Tooltip content={t('agent.preview_pane.settings.title')} delay={800}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={buttonClassName}
            aria-label={t('agent.preview_pane.settings.title')}>
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('agent.preview_pane.settings.tree_position')}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={settings.treePosition}
                onValueChange={(value) => void setSettings({ treePosition: value === 'right' ? 'right' : 'left' })}>
                <DropdownMenuRadioItem value="left">{t('agent.preview_pane.settings.tree_left')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="right">
                  {t('agent.preview_pane.settings.tree_right')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        {TOGGLE_GROUPS.map((group, index) => (
          <Fragment key={index}>
            <DropdownMenuSeparator />
            {group.map(({ key, label }) => {
              const unavailable = key === 'wordWrap' && wordWrapUnavailable
              return (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={unavailable ? false : settings[key]}
                  disabled={unavailable}
                  onCheckedChange={(checked) => void setSettings({ [key]: checked === true })}
                  // Keep the menu open so several options can be flipped in a row.
                  onSelect={(event) => event.preventDefault()}>
                  <span className="flex flex-col">
                    {t(label)}
                    {unavailable ? (
                      <span className="text-xs text-muted-foreground">
                        {t('agent.preview_pane.settings.word_wrap_unavailable')}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuCheckboxItem>
              )
            })}
          </Fragment>
        ))}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('agent.preview_pane.settings.tab_size')}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={String(settings.tabSize)}
                onValueChange={(value) => void setSettings({ tabSize: Number(value) })}>
                {TAB_SIZES.map((size) => (
                  <DropdownMenuRadioItem key={size} value={String(size)}>
                    {size}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

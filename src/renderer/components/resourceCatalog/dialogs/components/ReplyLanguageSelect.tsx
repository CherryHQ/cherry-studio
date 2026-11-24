import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import { AGENT_LANGUAGE_MAX_LENGTH, AGENT_LANGUAGE_PRESETS } from '@renderer/utils/agent/agentLanguage'
import type { AgentFormState } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import { AgentLanguageSchema } from '@shared/data/types/agentLanguage'

type ReplyLanguageValue = Pick<AgentFormState, 'languageMode' | 'languageCustom'>

const OTHER_LANGUAGE = '__other_language__'

type ReplyLanguageSelectProps = {
  value: ReplyLanguageValue
  onChange: (patch: Partial<ReplyLanguageValue>) => void
  onDraftChange?: (draft: string | undefined) => void
  portalContainer?: HTMLElement | null
  triggerClassName?: string
}

/**
 * Reply language as one select over the `languageMode` / `languageCustom` mapping. Renders the select and,
 * for "Other language…", the input as siblings so the parent lays them out.
 */
export function ReplyLanguageSelect({
  value,
  onChange,
  onDraftChange,
  portalContainer,
  triggerClassName
}: ReplyLanguageSelectProps) {
  const { t } = useTranslation()
  const [globalLanguage] = usePreference('agent.language')
  const isPreset = AGENT_LANGUAGE_PRESETS.includes(value.languageCustom)
  // Stays on "Other" while typing, even when the text happens to match a preset.
  const [draft, setDraft] = useState<{ text: string; edited: boolean }>()
  // A change from elsewhere (another window, the profile pane) shows the stored value as it is.
  const [seen, setSeen] = useState(value)
  if (seen.languageMode !== value.languageMode || seen.languageCustom !== value.languageCustom) {
    setSeen(value)
    setDraft(undefined)
  }
  const selected =
    draft !== undefined || (value.languageMode === 'custom' && !isPreset)
      ? OTHER_LANGUAGE
      : value.languageMode === 'custom'
        ? value.languageCustom
        : value.languageMode
  const label = t('library.config.agent.field.language.label')

  const handleChange = (next: string) => {
    // Radix's hidden native select can briefly emit an empty value.
    if (!next) return
    if (next === OTHER_LANGUAGE) {
      const text = value.languageMode === 'custom' && !isPreset ? value.languageCustom : ''
      setDraft({ text, edited: false })
      onDraftChange?.(text)
      return
    }
    setDraft(undefined)
    onDraftChange?.(undefined)
    if (next === 'inherit' || next === 'off') onChange({ languageMode: next, languageCustom: '' })
    else onChange({ languageMode: 'custom', languageCustom: next })
  }

  return (
    <>
      <Select value={selected} onValueChange={handleChange}>
        <SelectTrigger aria-label={label} className={cn('h-9 w-full rounded-md', triggerClassName)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent portalContainer={portalContainer}>
          <SelectItem value="inherit">
            {t('library.config.agent.field.language.inherit', {
              language: globalLanguage || t('settings.agent.language.follow_conversation')
            })}
          </SelectItem>
          <SelectItem value="off">{t('library.config.agent.field.language.mode.off')}</SelectItem>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>{t('library.config.agent.field.language.preset_group')}</SelectLabel>
            {AGENT_LANGUAGE_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {preset}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value={OTHER_LANGUAGE}>{t('library.config.agent.field.language.other')}</SelectItem>
        </SelectContent>
      </Select>
      {selected === OTHER_LANGUAGE ? (
        <Input
          value={draft?.text ?? value.languageCustom}
          maxLength={AGENT_LANGUAGE_MAX_LENGTH}
          spellCheck={false}
          placeholder={t('library.config.agent.field.language.other_placeholder')}
          aria-label={t('settings.agent.language.custom_label')}
          onBlur={() => {
            if (draft === undefined) return
            setDraft(undefined)
            onDraftChange?.(undefined)
            if (!draft.edited) return
            const languageCustom = draft.text.trim()
            if (!languageCustom) {
              onChange({ languageMode: 'inherit', languageCustom: '' })
              return
            }
            const parsed = AgentLanguageSchema.safeParse(languageCustom)
            if (parsed.success) onChange({ languageMode: 'custom', languageCustom: parsed.data })
            else toast.error(t('settings.agent.language.error.multiline'))
          }}
          onChange={(event) => {
            setDraft({ text: event.target.value, edited: true })
            onDraftChange?.(event.target.value)
          }}
        />
      ) : null}
    </>
  )
}

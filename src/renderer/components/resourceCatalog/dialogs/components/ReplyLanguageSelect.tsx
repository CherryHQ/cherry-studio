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
import { AGENT_LANGUAGE_MAX_LENGTH, AGENT_LANGUAGE_PRESETS } from '@renderer/utils/agent/agentLanguage'
import type { AgentFormState } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'

type ReplyLanguageValue = Pick<AgentFormState, 'languageMode' | 'languageCustom'>

const OTHER_LANGUAGE = '__other_language__'

type ReplyLanguageSelectProps = {
  value: ReplyLanguageValue
  onChange: (patch: Partial<ReplyLanguageValue>) => void
  portalContainer?: HTMLElement | null
  triggerClassName?: string
}

/**
 * Reply language as one select over the `languageMode` / `languageCustom` mapping. Renders the select and,
 * for "Other language…", the input as siblings so the parent lays them out.
 */
export function ReplyLanguageSelect({ value, onChange, portalContainer, triggerClassName }: ReplyLanguageSelectProps) {
  const { t } = useTranslation()
  const [globalLanguage] = usePreference('agent.language')
  const isPreset = AGENT_LANGUAGE_PRESETS.includes(value.languageCustom)
  // Stays on "Other" while typing, even when the text happens to match a preset.
  const [otherChosen, setOtherChosen] = useState(value.languageMode === 'custom' && !isPreset)
  const selected =
    value.languageMode !== 'custom'
      ? value.languageMode
      : otherChosen || !isPreset
        ? OTHER_LANGUAGE
        : value.languageCustom
  const label = t('library.config.agent.field.language.label')

  const handleChange = (next: string) => {
    // Radix's hidden native select can briefly emit an empty value.
    if (!next) return
    setOtherChosen(next === OTHER_LANGUAGE)
    if (next === 'inherit' || next === 'off') onChange({ languageMode: next })
    else if (next === OTHER_LANGUAGE)
      onChange({ languageMode: 'custom', languageCustom: isPreset ? '' : value.languageCustom })
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
          value={value.languageCustom}
          maxLength={AGENT_LANGUAGE_MAX_LENGTH}
          spellCheck={false}
          placeholder={t('library.config.agent.field.language.other_placeholder')}
          aria-label={t('settings.agent.language.custom_label')}
          onChange={(event) => onChange({ languageCustom: event.target.value })}
        />
      ) : null}
    </>
  )
}

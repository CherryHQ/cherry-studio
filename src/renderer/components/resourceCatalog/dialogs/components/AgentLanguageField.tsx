import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox, Input } from '@cherrystudio/ui'
import { AGENT_LANGUAGE_PRESETS, validateAgentLanguageInput } from '@renderer/utils/agent/agentLanguage'

const FOLLOW_VALUE = '__follow__'

type AgentLanguageFieldProps = {
  value: string | null
  onChange: (next: string | null) => void
  nullOptionLabel: string
  customPlaceholder: string
  comboLabel: string
  inputLabel: string
}

export function AgentLanguageField({
  value,
  onChange,
  nullOptionLabel,
  customPlaceholder,
  comboLabel,
  inputLabel
}: AgentLanguageFieldProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value ?? '')
  const [errorKey, setErrorKey] = useState<string | null>(null)

  useEffect(() => {
    setDraft(value ?? '')
    setErrorKey(null)
  }, [value])

  const comboValue = value === null ? FOLLOW_VALUE : AGENT_LANGUAGE_PRESETS.includes(value) ? value : ''

  const handleComboChange = (next: string | string[]) => {
    if (Array.isArray(next)) return
    if (next === FOLLOW_VALUE) {
      setDraft('')
      setErrorKey(null)
      onChange(null)
      return
    }
    setDraft(next)
    setErrorKey(null)
    onChange(next)
  }

  const handleInputBlur = () => {
    if (draft.trim() === '') {
      setErrorKey(null)
      if (value !== null) onChange(null)
      return
    }
    const result = validateAgentLanguageInput(draft)
    if (result.ok) {
      setErrorKey(null)
      if (result.value !== value) onChange(result.value)
    } else {
      setErrorKey(result.errorKey)
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <Combobox
        options={[
          { value: FOLLOW_VALUE, label: nullOptionLabel },
          ...AGENT_LANGUAGE_PRESETS.map((preset) => ({ value: preset, label: preset }))
        ]}
        value={comboValue}
        onChange={handleComboChange}
        aria-label={comboLabel}
        placeholder={nullOptionLabel}
        emptyText={t('common.no_results')}
        searchPlaceholder={t('common.search')}
      />
      <Input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setErrorKey(null)
        }}
        onBlur={handleInputBlur}
        placeholder={customPlaceholder}
        aria-label={inputLabel}
        spellCheck={false}
      />
      {errorKey ? <p className="text-destructive text-xs">{t(errorKey)}</p> : null}
    </div>
  )
}

import { Combobox, type ComboboxOption } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  allTagNames: string[]
  disabled?: boolean
  portalContainer?: HTMLElement | null
}

export const TagSelector: FC<Props> = ({ value, onChange, allTagNames, disabled, portalContainer }) => {
  const { t } = useTranslation()

  // `value` may contain names not present in `/tags` yet, for example while a
  // caller waits for SWR refresh. Keep selected names visible in the options.
  const tagOptions = useMemo<ComboboxOption[]>(() => {
    const names = Array.from(new Set([...allTagNames, ...value]))
    names.sort((a, b) => a.localeCompare(b, 'zh'))
    return names.map((name) => ({
      value: name,
      label: name
    }))
  }, [allTagNames, value])

  return (
    <Combobox
      multiple
      searchable={false}
      size="sm"
      disabled={disabled}
      options={tagOptions}
      value={value}
      onChange={(v) => onChange(Array.isArray(v) ? v : v ? [v] : [])}
      placeholder={t('library.config.basic.tag_placeholder')}
      emptyText={t('library.config.basic.tag_empty')}
      portalContainer={portalContainer ?? undefined}
    />
  )
}

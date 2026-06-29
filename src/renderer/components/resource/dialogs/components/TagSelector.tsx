import { Combobox, type ComboboxOption } from '@cherrystudio/ui'
import { TagNameSchema } from '@shared/data/types/tag'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  value: string | null
  onChange: (tag: string | null) => void
  allTagNames: string[]
  disabled?: boolean
  portalContainer?: HTMLElement | null
}

export const TagSelector: FC<Props> = ({ value, onChange, allTagNames, disabled, portalContainer }) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  // `value` may be a name not present in `/tags` yet, for example while a
  // caller waits for SWR refresh. Keep the selected name visible in the options.
  const tagOptions = useMemo<ComboboxOption[]>(() => {
    const trimmedSearch = search.trim()
    const names = new Set(allTagNames)
    if (value) names.add(value)
    // Mirror the server-side TagNameSchema (z.string().trim().min(1).max(64))
    // so a user cannot select a name the create endpoint would reject.
    if (trimmedSearch && TagNameSchema.safeParse(trimmedSearch).success) {
      names.add(trimmedSearch)
    }

    const sortedNames = Array.from(names)
    sortedNames.sort((a, b) => a.localeCompare(b, 'zh'))
    return sortedNames.map((name) => ({
      value: name,
      label: name
    }))
  }, [allTagNames, search, value])

  return (
    <Combobox
      size="sm"
      disabled={disabled}
      options={tagOptions}
      value={value ?? ''}
      onChange={(v) => onChange((Array.isArray(v) ? v[0] : v) || null)}
      onSearch={setSearch}
      placeholder={t('library.config.basic.tag_placeholder')}
      searchPlaceholder={t('library.config.basic.tag_search')}
      emptyText={t('library.config.basic.tag_empty')}
      portalContainer={portalContainer ?? undefined}
    />
  )
}

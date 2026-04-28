import { Badge, Combobox, type ComboboxOption } from '@cherrystudio/ui'
import { Check, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_TAG_COLOR } from './constants'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  tagColorByName: Map<string, string>
  allTagNames: string[]
  disabled?: boolean
}

export const TagSelector: FC<Props> = ({ value, onChange, tagColorByName, allTagNames, disabled }) => {
  const { t } = useTranslation()
  const tagColor = useCallback(
    (name: string): string => tagColorByName.get(name) ?? DEFAULT_TAG_COLOR,
    [tagColorByName]
  )

  // `value` may contain names not present in `/tags` yet, for example while a
  // caller waits for SWR refresh. Keep selected names visible in the options.
  const tagOptions = useMemo<ComboboxOption[]>(() => {
    const names = Array.from(new Set([...allTagNames, ...value]))
    names.sort((a, b) => a.localeCompare(b, 'zh'))
    return names.map((name) => ({
      value: name,
      label: name,
      icon: (
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: tagColor(name) }}
          aria-hidden="true"
        />
      )
    }))
  }, [allTagNames, value, tagColor])

  return (
    <Combobox
      multiple
      searchable
      disabled={disabled}
      options={tagOptions}
      value={value}
      onChange={(v) => onChange(Array.isArray(v) ? v : v ? [v] : [])}
      placeholder={t('library.config.basic.tag_placeholder')}
      searchPlaceholder={t('library.config.basic.tag_search')}
      emptyText={t('library.config.basic.tag_empty')}
      className="min-h-8 w-full items-center rounded-xs border-border/20 bg-accent/15 px-2 py-1 text-xs shadow-none transition-all hover:border-border/40 hover:bg-accent/20 aria-expanded:border-border/40 aria-expanded:bg-accent/20 aria-expanded:ring-0"
      popoverClassName="rounded-xs border-border/30 p-1 shadow-lg shadow-black/[0.06]"
      renderValue={(selectedValue) => {
        const selected = Array.isArray(selectedValue) ? selectedValue : selectedValue ? [selectedValue] : []
        const hasSelection = selected.length > 0
        return (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {hasSelection ? (
                selected.map((name) => (
                  <Badge
                    key={name}
                    variant="outline"
                    className="gap-1.5 border-border/40 bg-card py-0.5 pr-1 pl-2 font-normal shadow-2xs shadow-black/[0.03] hover:border-border/60">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tagColor(name) }}
                      aria-hidden="true"
                    />
                    <span>{name}</span>
                    <button
                      type="button"
                      aria-label={t('common.remove')}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onChange(value.filter((tag) => tag !== name))
                      }}
                      className="ml-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none">
                      <X size={9} />
                    </button>
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground/50">{t('library.config.basic.tag_placeholder')}</span>
              )}
            </div>
            {hasSelection && (
              <button
                type="button"
                aria-label={t('common.clear')}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onChange([])
                }}
                className="inline-flex size-3 shrink-0 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none">
                <X size={8} />
              </button>
            )}
          </div>
        )
      }}
      renderOption={(option) => {
        const checked = value.includes(option.value)
        const color = tagColor(option.value)
        return (
          <>
            <span
              className="size-2 shrink-0 rounded-full transition-all duration-200"
              style={{
                backgroundColor: color,
                boxShadow: checked ? `0 0 0 2.5px ${color}33` : undefined
              }}
              aria-hidden="true"
            />
            <span
              className={`flex-1 truncate text-xs transition-colors ${
                checked ? 'text-foreground' : 'text-muted-foreground/80'
              }`}>
              {option.label}
            </span>
            {checked && <Check size={12} className="shrink-0 text-foreground" />}
          </>
        )
      }}
    />
  )
}

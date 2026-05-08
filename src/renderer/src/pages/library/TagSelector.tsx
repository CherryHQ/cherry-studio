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
    <div className="rounded-xs border border-border/20 bg-accent/15 transition-colors focus-within:border-border/40 focus-within:bg-accent/20 hover:border-border/40 hover:bg-accent/20">
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
        className="h-auto min-h-0 w-full items-center rounded-[12px] border-0 bg-transparent px-2 py-1 font-normal text-foreground text-xs shadow-none transition-colors hover:bg-accent/50 focus-visible:ring-0 aria-expanded:bg-accent/50 aria-expanded:ring-0 dark:bg-transparent [&>svg]:size-3 [&>svg]:text-muted-foreground/50"
        popoverClassName="rounded-xs border-border/30 p-1 shadow-lg shadow-black/[0.06] [&_[data-slot=command-empty]]:py-5 [&_[data-slot=command-empty]]:font-normal [&_[data-slot=command-empty]]:text-muted-foreground/45 [&_[data-slot=command-empty]]:text-xs [&_[data-slot=command-input-wrapper]]:h-8 [&_[data-slot=command-input-wrapper]]:px-2.5 [&_[data-slot=command-input-wrapper]_svg]:size-3.5 [&_[data-slot=command-input-wrapper]_svg]:opacity-40 [&_[data-slot=command-input]]:h-8 [&_[data-slot=command-input]]:py-1.5 [&_[data-slot=command-input]]:text-xs"
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
                      className="gap-1.5 rounded-[10px] border-border/35 bg-background/70 py-0 pr-1 pl-1.5 font-normal text-[11px] leading-4 shadow-none hover:border-border/60">
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
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-3xs text-muted-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none">
                  <X size={10} />
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
    </div>
  )
}

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  value: string | null
  onChange: (tag: string | null) => void
  allTagNames: string[]
  disabled?: boolean
  portalContainer?: HTMLElement | null
}

const TAG_SELECT_VALUE_PREFIX = 'tag:'

function encodeTagSelectValue(name: string) {
  return `${TAG_SELECT_VALUE_PREFIX}${name}`
}

function decodeTagSelectValue(value: string) {
  if (!value.startsWith(TAG_SELECT_VALUE_PREFIX)) return null
  return value.slice(TAG_SELECT_VALUE_PREFIX.length)
}

export const TagSelector: FC<Props> = ({ value, onChange, allTagNames, disabled, portalContainer }) => {
  const { t } = useTranslation()

  // `value` may be a name not present in `/tags` yet, for example while a
  // caller waits for SWR refresh. Keep the selected name visible in the options.
  const tagNames = useMemo(() => {
    const names = new Set(allTagNames)
    if (value) names.add(value)

    const sortedNames = Array.from(names)
    sortedNames.sort((a, b) => a.localeCompare(b, 'zh'))
    return sortedNames
  }, [allTagNames, value])

  return (
    <div className="group/tag-select relative flex w-full min-w-0 items-center">
      <Select
        disabled={disabled}
        value={value ? encodeTagSelectValue(value) : ''}
        onValueChange={(selectedValue) => onChange(decodeTagSelectValue(selectedValue))}>
        <SelectTrigger
          size="sm"
          className={cn('w-full', value && '[&_svg]:transition-opacity group-hover/tag-select:[&_svg]:opacity-0')}
          aria-label={t('library.config.basic.tags')}>
          <SelectValue placeholder={t('library.config.basic.tag_placeholder')} />
        </SelectTrigger>
        <SelectContent portalContainer={portalContainer ?? undefined}>
          {tagNames.map((name) => (
            <SelectItem key={name} value={encodeTagSelectValue(name)}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`${t('library.config.basic.tags')} ${t('common.clear')}`}
          onClick={(event) => {
            event.stopPropagation()
            onChange(null)
          }}
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 flex size-5 min-h-0 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground/70 opacity-0 shadow-none transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground active:bg-muted group-hover/tag-select:pointer-events-auto group-hover/tag-select:opacity-100">
          <X size={12} />
        </Button>
      ) : null}
    </div>
  )
}

import { ChevronDown, Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'

import { SkillTagPicker } from './SkillTagPicker'
import type { SkillLibraryTagManager } from './useSkillLibraryTags'

export type LibraryFilters = {
  sort: 'updatedAt' | 'createdAt' | 'name'
  source: 'all' | 'online' | 'local'
  tags: string[]
}
export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = { sort: 'updatedAt', source: 'all', tags: [] }

export function MyResourcesFilter({
  value,
  onChange,
  manager,
  counts
}: {
  value: LibraryFilters
  onChange: (value: LibraryFilters) => void
  manager: SkillLibraryTagManager
  counts: Record<string, number>
}) {
  const { t } = useTranslation()
  const active = value.source !== 'all' || value.tags.length > 0
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full" data-active={active}>
          <Filter className="size-3.5" />
          {t('marketplace.filter')}
          {active ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-4 rounded-3xl p-4">
        {(
          [
            {
              key: 'sort',
              label: 'selector.common.sort_label',
              options: [
                ['updatedAt', 'marketplace.sort_recent'],
                ['createdAt', 'marketplace.sort_created'],
                ['name', 'marketplace.sort_name']
              ]
            },
            {
              key: 'source',
              label: 'library.skill_marketplace.source_label',
              options: [
                ['all', 'common.all'],
                ['online', 'marketplace.online_source'],
                ['local', 'marketplace.local_source']
              ]
            }
          ] as const
        ).map(({ key, label, options }) => (
          <div key={key} className="space-y-2">
            <h3 className="text-xs text-foreground-tertiary">{t(label)}</h3>
            <div className="flex flex-wrap gap-1">
              {options.map(([option, text]: readonly [string, string]) => (
                <Button
                  key={option}
                  size="sm"
                  variant="ghost"
                  className={`h-6 rounded-full px-2 text-xs ${value[key] === option ? 'bg-accent' : 'text-muted-foreground'}`}
                  aria-pressed={value[key] === option}
                  onClick={() => onChange({ ...value, [key]: option })}>
                  {t(text)}
                </Button>
              ))}
            </div>
          </div>
        ))}
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <h3 className="text-xs text-foreground-tertiary">{t('library.config.basic.tags')}</h3>
          <SkillTagPicker
            manager={manager}
            counts={counts}
            selected={value.tags}
            onToggle={(id) =>
              onChange({
                ...value,
                tags: value.tags.includes(id) ? value.tags.filter((tag) => tag !== id) : [...value.tags, id]
              })
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

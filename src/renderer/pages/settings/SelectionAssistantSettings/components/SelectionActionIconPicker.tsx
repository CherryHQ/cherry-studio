import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, Dices } from 'lucide-react'
import { DynamicIcon, iconNames } from 'lucide-react/dynamic'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'

interface SelectionActionIconPickerProps {
  value: string
  onChange: (icon: string) => void
}

const ICON_COLUMNS = 6
const ICON_ROW_HEIGHT = 40

const SelectionActionIconPicker = ({ value, onChange }: SelectionActionIconPickerProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const filteredIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery ? iconNames.filter((name) => name.includes(normalizedQuery)) : iconNames
  }, [query])
  const valueIsAvailable = iconNames.includes(value as (typeof iconNames)[number])
  const rowCount = Math.ceil(filteredIcons.length / ICON_COLUMNS)
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => listRef.current,
    estimateSize: () => ICON_ROW_HEIGHT,
    overscan: 3
  })

  const selectIcon = (icon: string) => {
    onChange(icon)
    setOpen(false)
  }

  const selectRandomIcon = () => {
    selectIcon(iconNames[Math.floor(Math.random() * iconNames.length)])
  }

  return (
    <div className="flex w-full gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-0 flex-1 justify-start gap-2">
            {value && valueIsAvailable ? (
              <>
                <DynamicIcon name={value as (typeof iconNames)[number]} size={16} />
                <span className="truncate">{value}</span>
              </>
            ) : value ? (
              <span className="truncate">{value}</span>
            ) : (
              <span className="truncate text-muted-foreground">
                {t('selection.settings.user_modal.icon.placeholder')}
              </span>
            )}
            <ChevronDown size={14} className="ml-auto shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <Input
            autoFocus
            aria-label={t('common.search')}
            placeholder={t('common.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div ref={listRef} className="mt-2 h-64 overflow-y-auto">
            {filteredIcons.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t('common.no_results')}</div>
            ) : (
              <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((row) => {
                  const startIndex = row.index * ICON_COLUMNS
                  const rowIcons = filteredIcons.slice(startIndex, startIndex + ICON_COLUMNS)

                  return (
                    <div
                      key={row.key}
                      ref={virtualizer.measureElement}
                      data-index={row.index}
                      className="absolute left-0 top-0 grid w-full grid-cols-6 gap-1"
                      style={{ height: ICON_ROW_HEIGHT, transform: `translateY(${row.start}px)` }}>
                      {rowIcons.map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          aria-label={icon}
                          aria-pressed={value === icon}
                          title={icon}
                          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          onClick={() => selectIcon(icon)}>
                          <DynamicIcon name={icon} size={18} />
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Tooltip content={t('selection.settings.user_modal.icon.random')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('selection.settings.user_modal.icon.random')}
          onClick={selectRandomIcon}>
          <Dices size={14} />
        </Button>
      </Tooltip>
    </div>
  )
}

export default SelectionActionIconPicker

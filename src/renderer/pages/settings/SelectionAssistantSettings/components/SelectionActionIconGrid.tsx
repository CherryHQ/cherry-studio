import { useVirtualizer } from '@tanstack/react-virtual'
import { DynamicIcon } from 'lucide-react/dynamic'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@cherrystudio/ui'

import { searchSelectionIcons } from './selectionIconSearch'

const ICON_COLUMNS = 6
const ICON_ROW_HEIGHT = 40

const SelectionActionIconGrid = ({ value, onSelect }: { value: string; onSelect: (icon: string) => void }) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const filteredIcons = useMemo(() => searchSelectionIcons(query), [query])
  const virtualizer = useVirtualizer({
    count: Math.ceil(filteredIcons.length / ICON_COLUMNS),
    getScrollElement: () => scrollElement,
    estimateSize: () => ICON_ROW_HEIGHT,
    overscan: 3
  })

  return (
    <>
      <Input
        autoFocus
        aria-label={t('common.search')}
        placeholder={t('common.search')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          // A new result set starts at its first row, not at the previous scroll position.
          if (scrollElement) scrollElement.scrollTop = 0
          virtualizer.scrollToOffset(0)
        }}
      />
      <div
        ref={setScrollElement}
        className="mt-2 h-64 overflow-y-auto"
        style={{ maxHeight: 'calc(var(--radix-popover-content-available-height) - 104px)' }}>
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
                      className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      onClick={() => onSelect(icon)}>
                      <DynamicIcon name={icon} size={18} />
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

export default SelectionActionIconGrid

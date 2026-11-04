import { ChevronRight } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  SearchInput,
  Switch
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

export type SettingsPickerItem = {
  id: string
  title: string
  description?: string
  badge?: string
  checked: boolean
  /** The switch is shown but cannot be flipped (e.g. an inactive server). */
  disabled?: boolean
}

export type SettingsPickerSection = { label?: string; items: SettingsPickerItem[] }

/** The value-and-chevron trigger shared by every settings row that opens a picker or a sub-page. */
export const settingsValueButtonClassName =
  '-mr-2 h-8 gap-1 rounded-lg px-2 font-normal text-muted-foreground text-sm shadow-none hover:bg-foreground/[0.05] hover:text-foreground aria-expanded:bg-foreground/[0.05] aria-expanded:text-foreground'

/**
 * A searchable list of switches that opens in place from a settings row. Toggling writes straight
 * through `onToggle`, so the owning form keeps its own save path.
 */
export function SettingsPickerPopover({
  label,
  summary,
  sections,
  onToggle,
  open,
  onOpenChange,
  portalContainer,
  emptyLabel,
  notice,
  footer,
  disabled = false
}: {
  label: string
  summary: string
  sections: SettingsPickerSection[]
  onToggle: (id: string, checked: boolean) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  portalContainer: HTMLElement | null
  emptyLabel: string
  notice?: ReactNode
  footer?: ReactNode
  /** The list stays browsable while the switches are locked (e.g. until the owner's data is ready). */
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const total = sections.reduce((count, section) => count + section.items.length, 0)
  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          [section.label, item.title, item.description].some((text) => text?.toLowerCase().includes(q))
        )
      }))
      .filter((section) => section.items.length > 0)
  }, [query, sections])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('')
        onOpenChange(next)
      }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={`${label}: ${summary}`}
          className={settingsValueButtonClassName}>
          {summary}
          <ChevronRight aria-hidden className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        align="end"
        collisionPadding={12}
        aria-label={label}
        className="flex max-h-[min(400px,55vh)] w-80 flex-col p-0">
        <div className="border-border-subtle border-b p-1.5">
          <SearchInput
            autoFocus
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            clearLabel={t('common.clear')}
            placeholder={t('common.search')}
            containerClassName="h-8 border-0 bg-muted/50 shadow-none"
          />
        </div>
        {notice ? <div className="border-border-subtle border-b p-2.5 text-xs">{notice}</div> : null}
        <ScrollArea viewportProps={{ className: 'p-1' }} className="min-h-0 flex-1">
          {visibleSections.length > 0 ? (
            visibleSections.map((section, index) => (
              <div key={section.label ?? index}>
                {section.label ? (
                  <div className="px-2.5 pt-2 pb-1 text-[11px] text-muted-foreground">{section.label}</div>
                ) : null}
                {section.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-foreground/[0.04]">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5 text-sm">
                        <span className={cn('truncate', item.disabled && 'text-muted-foreground')}>{item.title}</span>
                        {item.badge ? (
                          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                            {item.badge}
                          </Badge>
                        ) : null}
                      </div>
                      {item.description ? (
                        <div className="truncate text-muted-foreground text-xs">{item.description}</div>
                      ) : null}
                    </div>
                    <Switch
                      size="xs"
                      aria-label={item.title}
                      checked={item.checked}
                      disabled={disabled || item.disabled}
                      onCheckedChange={(checked) => onToggle(item.id, checked)}
                    />
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="px-3 py-6 text-center text-muted-foreground text-xs">
              {total > 0 ? t('common.no_results') : emptyLabel}
            </div>
          )}
        </ScrollArea>
        {footer ? <div className="flex flex-col border-border-subtle border-t p-1">{footer}</div> : null}
      </PopoverContent>
    </Popover>
  )
}

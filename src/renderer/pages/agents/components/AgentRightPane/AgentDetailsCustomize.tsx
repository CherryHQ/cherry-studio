import { GripVertical, MoreVertical, RotateCcw } from 'lucide-react'
import { type ComponentProps, type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger, ReorderableList, Switch } from '@cherrystudio/ui'
import type { AgentDetailsSectionConfig } from '@shared/data/preference/preferenceTypes'

type SectionItem = AgentDetailsSectionConfig & { label: string; icon: ReactNode }

export function AgentDetailsCustomize({
  items,
  onChange,
  onReset,
  isDefault
}: {
  items: SectionItem[]
  onChange: (items: AgentDetailsSectionConfig[]) => void
  onReset: () => void
  isDefault: boolean
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const nameOf = (id: string | number) => items.find((item) => item.id === id)?.label ?? String(id)
  const accessibility = {
    screenReaderInstructions: { draggable: t('agent.right_pane.details.drag_instructions') },
    announcements: {
      onDragStart: ({ activeId }) => t('chat.input.toolbar.drag.picked_up', { name: nameOf(activeId) }),
      onDragOver: ({ activeId, overId }) =>
        overId !== null
          ? t('chat.input.toolbar.drag.over', { name: nameOf(activeId), over: nameOf(overId) })
          : undefined,
      onDragEnd: ({ activeId }) => t('chat.input.toolbar.drag.dropped', { name: nameOf(activeId) }),
      onDragCancel: ({ activeId }) => t('chat.input.toolbar.drag.cancelled', { name: nameOf(activeId) })
    }
  } satisfies ComponentProps<typeof ReorderableList<SectionItem>>['accessibility']

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('agent.right_pane.details.customize')}
          className="text-muted-foreground">
          <MoreVertical className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        alignOffset={-16}
        className="w-70 max-w-[calc(100vw_-_24px)] p-1.5"
        aria-labelledby={titleId}>
        <div id={titleId} className="px-2 py-1.5 text-sm font-medium">
          {t('agent.right_pane.details.customize')}
        </div>
        <div className="max-h-[min(60vh,24rem)] overflow-y-auto">
          <ReorderableList
            items={items}
            getId={(item) => item.id}
            onReorder={(next) => onChange(next.map(({ id, visible }) => ({ id, visible })))}
            direction="vertical"
            gap={1}
            dragHandle
            accessibility={accessibility}
            itemStyle={{ cursor: 'default' }}
            renderItem={(item, _index, { dragHandleProps }) => (
              <div className="flex min-h-9 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  {...dragHandleProps}
                  className="size-6 shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
                  aria-label={t('chat.input.toolbar.drag_handle', { name: item.label })}>
                  <GripVertical className="size-3.5" />
                </Button>
                <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 flex-1 text-sm">{item.label}</span>
                <Switch
                  size="xs"
                  checked={item.visible}
                  aria-label={item.label}
                  onCheckedChange={(visible) =>
                    onChange(
                      items.map(({ id, visible: current }) => ({ id, visible: id === item.id ? visible : current }))
                    )
                  }
                />
              </div>
            )}
          />
        </div>
        <div className="mx-1.5 mt-1 border-t border-border-subtle pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            disabled={isDefault}
            onClick={onReset}>
            <RotateCcw className="size-4" />
            {t('chat.input.toolbar.restore_default')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

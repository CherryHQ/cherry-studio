import { Button, Sortable } from '@cherrystudio/ui'
import { REQUIRED_SIDEBAR_ICONS, SIDEBAR_ICON_COMPONENTS } from '@renderer/config/sidebar'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { cn } from '@renderer/utils'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { ArrowLeft, Eye, EyeOff, GripVertical, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type GlobalSearchQuickAppManagerItem = {
  icon: SidebarIcon
  label: string
  visible: boolean
}

export function GlobalSearchQuickAppManager({
  icons,
  onBack,
  onReorder,
  onReset,
  onVisibilityChange,
  visibleIcons
}: {
  icons: SidebarIcon[]
  visibleIcons: ReadonlySet<SidebarIcon>
  onBack: () => void
  onReorder: (event: { oldIndex: number; newIndex: number }) => void
  onReset: () => void
  onVisibilityChange: (icon: SidebarIcon, visible: boolean) => void
}) {
  const { t } = useTranslation()
  const items = useMemo<GlobalSearchQuickAppManagerItem[]>(
    () =>
      icons.map((icon) => ({
        icon,
        label: getSidebarIconLabel(icon),
        visible: visibleIcons.has(icon)
      })),
    [icons, visibleIcons]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-label={t('common.back')}
            onClick={onBack}
            className="size-8 shrink-0 rounded-[8px] p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <div className="font-medium text-foreground text-sm">{t('globalSearch.quickApps.manager_title')}</div>
            <div className="truncate text-muted-foreground text-xs">
              {t('globalSearch.quickApps.manager_description')}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          className="h-8 shrink-0 gap-1.5 rounded-[8px] px-2 text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground">
          <RotateCcw className="size-3.5" />
          <span>{t('globalSearch.quickApps.reset')}</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <div className="flex w-full flex-col gap-1" data-testid="quick-app-manager-list">
          <Sortable
            items={items}
            itemKey="icon"
            onSortEnd={onReorder}
            gap={4}
            restrictions={{ scrollableAncestor: true }}
            showGhost
            renderItem={(item, { dragging }) => (
              <GlobalSearchQuickAppManagerRow item={item} dragging={dragging} onVisibilityChange={onVisibilityChange} />
            )}
          />
        </div>
      </div>
    </div>
  )
}

function GlobalSearchQuickAppManagerRow({
  dragging,
  item,
  onVisibilityChange
}: {
  dragging: boolean
  item: GlobalSearchQuickAppManagerItem
  onVisibilityChange: (icon: SidebarIcon, visible: boolean) => void
}) {
  const { t } = useTranslation()
  const Icon = SIDEBAR_ICON_COMPONENTS[item.icon]
  const isRequired = REQUIRED_SIDEBAR_ICONS.includes(item.icon)
  const nextVisible = !item.visible

  return (
    <div
      className={cn(
        'flex h-[56px] items-center gap-3 rounded-[12px] px-3 transition-colors',
        'hover:bg-muted/40',
        dragging && 'bg-muted/50 shadow-sm',
        item.visible ? 'text-foreground' : 'text-muted-foreground opacity-60'
      )}>
      <GripVertical className="size-4 shrink-0 text-muted-foreground/60" />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{item.label}</span>
      <Button
        type="button"
        variant="ghost"
        disabled={isRequired}
        aria-label={t(item.visible ? 'globalSearch.quickApps.hide' : 'globalSearch.quickApps.show', {
          name: item.label
        })}
        aria-pressed={item.visible}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onVisibilityChange(item.icon, nextVisible)}
        className="size-8 shrink-0 rounded-[8px] p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
        {item.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </Button>
    </div>
  )
}

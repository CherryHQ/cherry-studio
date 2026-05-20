import { Scrollbar, Sortable, Tooltip } from '@cherrystudio/ui'
import { LogoAvatar } from '@renderer/components/Icons'
import { getMiniAppsLogo } from '@renderer/config/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { ArrowLeftToLine, ArrowRightToLine } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  title: string
  count: number
  apps: MiniApp[]
  /** Toggle visibility (move to the other column). */
  onToggle: (app: MiniApp) => void
  /** Reorder within this column. */
  onReorder: (oldIndex: number, newIndex: number) => void
  emptyText?: string
  /** Action shown on each row. 'hide' moves right (visible→hidden), 'show' moves left (hidden→visible). */
  toggleAction: 'hide' | 'show'
}

/** One column of the visible / hidden list pair. Fills the height of its parent row. */
const MiniAppListColumn: FC<Props> = ({ title, count, apps, onToggle, onReorder, emptyText, toggleAction }) => {
  const { t } = useTranslation()

  const Icon = toggleAction === 'hide' ? ArrowRightToLine : ArrowLeftToLine
  const tooltip = toggleAction === 'hide' ? t('miniApp.sidebar.hide.title') : t('settings.miniApps.visible')

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1">
      {/* Secondary label — the lists themselves are the focus. Count sits next
          to its title so the relationship reads directly. */}
      <div className="flex items-center gap-1.5 px-2 text-muted-foreground">
        <span className="text-xs">{title}</span>
        <span className="text-xs tabular-nums">{count}</span>
      </div>
      {apps.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 py-6 text-center text-muted-foreground text-xs">
          {emptyText}
        </div>
      ) : (
        <Scrollbar className="min-h-0 flex-1 overflow-x-hidden">
          <Sortable
            items={apps}
            itemKey="appId"
            onSortEnd={({ oldIndex, newIndex }) => onReorder(oldIndex, newIndex)}
            gap={2}
            renderItem={(app) => (
              <Tooltip content={tooltip} placement="left" classNames={{ placeholder: 'block w-full' }}>
                <div
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onToggle(app)
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(app)
                  }}
                  aria-label={tooltip}>
                  {/*
                   * app.logo is the preset's CompoundIcon ID (e.g. "Moonshot") for
                   * preset rows and a URL/path for custom rows. Resolve the ID to a
                   * CompoundIcon before passing to LogoAvatar so preset icons render
                   * via Icon.Avatar instead of being treated as a broken image URL.
                   */}
                  <LogoAvatar logo={getMiniAppsLogo(app.logo) ?? app.logo} size={16} />
                  <span className="min-w-0 flex-1 truncate text-left text-foreground text-sm">
                    {app.nameKey ? t(app.nameKey) : app.name}
                  </span>
                  <span
                    className="flex size-6 shrink-0 items-center justify-center text-muted-foreground/40"
                    aria-hidden="true">
                    <Icon className="size-3.5" />
                  </span>
                </div>
              </Tooltip>
            )}
          />
        </Scrollbar>
      )}
    </div>
  )
}

export default MiniAppListColumn

import { Sortable, Tooltip } from '@cherrystudio/ui'
import { LogoAvatar } from '@renderer/components/Icons'
import { getMiniAppsLogo } from '@renderer/config/miniapps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { Eye, EyeOff } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  title: string
  count: number
  apps: MiniApp[]
  /** Toggle visibility (move to other column). */
  onToggle: (app: MiniApp) => void
  /** Reorder within this column. */
  onReorder: (oldIndex: number, newIndex: number) => void
  emptyText?: string
  /** Action shown on hover. 'hide' shows EyeOff (visible→hidden), 'show' shows Eye. */
  toggleAction: 'hide' | 'show'
}

const MiniAppListColumn: FC<Props> = ({ title, count, apps, onToggle, onReorder, emptyText, toggleAction }) => {
  const { t } = useTranslation()

  const Icon = toggleAction === 'hide' ? EyeOff : Eye
  const tooltip = toggleAction === 'hide' ? t('miniapp.sidebar.hide.title') : t('settings.miniapps.visible')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-muted-foreground/60">
        <span>{title}</span>
        <span>{count}</span>
      </div>
      {apps.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 py-6 text-center text-[11px] text-muted-foreground/40">
          {emptyText}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-0.5 [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-1">
          <Sortable
            items={apps}
            itemKey="appId"
            onSortEnd={({ oldIndex, newIndex }) => onReorder(oldIndex, newIndex)}
            gap={2}
            renderItem={(app) => (
              <div className="group/row flex w-full items-center gap-2 rounded-2xs px-1.5 py-1 hover:bg-accent/40">
                {/*
                 * app.logo is the preset's CompoundIcon ID (e.g. "Moonshot") for
                 * preset rows and a URL/path for custom rows. Resolve the ID to a
                 * CompoundIcon before passing to LogoAvatar so preset icons render
                 * via Icon.Avatar instead of being treated as a broken image URL.
                 */}
                <LogoAvatar logo={getMiniAppsLogo(app.logo) ?? app.logo} size={20} />
                <span className="min-w-0 flex-1 truncate text-left text-[12px] text-foreground">
                  {app.nameKey ? t(app.nameKey) : app.name}
                </span>
                <Tooltip content={tooltip} placement="left">
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggle(app)
                    }}
                    className="opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100"
                    aria-label={tooltip}>
                    <Icon size={14} className="text-muted-foreground/60" />
                  </button>
                </Tooltip>
              </div>
            )}
          />
        </div>
      )}
    </div>
  )
}

export default MiniAppListColumn

import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { APP_ICON_BACKGROUNDS, SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import MiniApp from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useLaunchpadAppOrder } from '@renderer/hooks/useLaunchpadAppOrder'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { getSidebarMenuPath } from '@renderer/utils/sidebar'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const GRID_CLASS = 'grid grid-cols-4 justify-items-center gap-2 px-2'
const SECTION_TITLE_CLASS = 'm-0 px-4 py-0 font-semibold text-[14px] text-foreground opacity-80'

interface Props {
  /**
   * App already shown in the other pane. One `<webview>` element renders in one
   * place, so picking it again would blank a pane — it is shown disabled.
   */
  occupiedAppId: string
  onClose: () => void
  className?: string
}

/**
 * Launchpad-shaped chooser for the split pane. Picking a mini app loads it into
 * the pool beside the active one; built-in apps are rendered but disabled — they
 * are routed pages and would need a second router to live in a pane.
 */
const SplitPanePicker: FC<Props> = ({ occupiedAppId, onClose, className }) => {
  const { t } = useTranslation()
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  // Every available mini app, not just the launchpad's pinned ones: presets
  // seed as `enabled`, so a pinned-only list is empty until the user pins
  // something, and the app to compare against is often not pinned anyway.
  const { miniApps } = useMiniApps()
  const { openMiniAppInSplit } = useMiniAppPopup()
  const { orderedAppIds } = useLaunchpadAppOrder()

  const appTiles = useMemo(
    () =>
      orderedAppIds.flatMap((favorite) => {
        const Icon = SIDEBAR_ICON_COMPONENTS[favorite]
        if (!Icon || !getSidebarMenuPath(favorite, defaultPaintingProvider)) return []

        return [
          {
            id: favorite,
            icon: <Icon size={32} />,
            text: t(getSidebarIconLabelKey(favorite)),
            bgColor: APP_ICON_BACKGROUNDS[favorite]
          }
        ]
      }),
    [defaultPaintingProvider, orderedAppIds, t]
  )

  const renderMiniApp = (app: MiniAppType) => {
    const isOccupied = app.appId === occupiedAppId
    return (
      <div
        key={app.appId}
        className={cn(
          'mx-auto flex w-[92px] justify-center rounded-[8px] py-2 transition-transform duration-200',
          isOccupied ? 'pointer-events-none opacity-40' : 'hover:scale-105 active:scale-95'
        )}
        title={isOccupied ? t('miniApp.split.already_open') : undefined}>
        <MiniApp app={app} size={56} variant="launchpad" onOpen={openMiniAppInSplit} />
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      {/* Matches MinimalToolbar's height so the close button lines up with the
          split button it replaces in the other pane. */}
      <div className="flex h-8.75 shrink-0 items-center justify-end bg-background px-3">
        <Tooltip content={t('miniApp.split.close')} placement="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="rounded text-muted-foreground shadow-none hover:text-foreground active:scale-95"
            aria-label={t('miniApp.split.close')}>
            <X size={14} />
          </Button>
        </Tooltip>
      </div>
      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-140 flex-col gap-5 py-8">
          <section className="flex flex-col gap-2">
            <h2 className={SECTION_TITLE_CLASS}>
              {t('launchpad.apps')}
              <span className="ml-2 font-normal text-[12px] text-muted-foreground">
                {t('miniApp.split.apps_unsupported')}
              </span>
            </h2>
            <div className={cn(GRID_CLASS, 'pointer-events-none opacity-40')}>
              {appTiles.map((item) => (
                <div key={item.id} className="mx-auto flex w-[92px] flex-col items-center gap-1 px-1 py-2 text-center">
                  <span
                    className="flex size-14 items-center justify-center rounded-2xl text-white shadow-sm [&_svg]:size-7 [&_svg]:text-white"
                    style={{ background: item.bgColor }}>
                    {item.icon}
                  </span>
                  <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {miniApps.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className={SECTION_TITLE_CLASS}>{t('launchpad.miniApps')}</h2>
              <div className={GRID_CLASS}>{miniApps.map(renderMiniApp)}</div>
            </section>
          )}
        </div>
      </Scrollbar>
    </div>
  )
}

export default SplitPanePicker

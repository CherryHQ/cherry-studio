import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import MiniApp from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

// Column count follows the pane width: a detached mini app window can be
// resized down to ~400px, leaving each half far narrower than a fixed grid.
const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] justify-items-center gap-2 px-2'

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
 * Chooser for the split pane: the mini apps that can sit beside the active one.
 * Built-in apps are deliberately absent — they are routed pages and would need
 * a second router instance to live in a pane.
 */
const SplitPanePicker: FC<Props> = ({ occupiedAppId, onClose, className }) => {
  const { t } = useTranslation()
  // Every available mini app, not just the launchpad's pinned ones: presets seed
  // as `enabled`, so a pinned-only list is empty until the user pins something.
  const { miniApps } = useMiniApps()
  const { openMiniAppInSplit } = useMiniAppPopup()

  const renderMiniApp = (app: MiniAppType) => {
    const isOccupied = app.appId === occupiedAppId
    return (
      <div
        key={app.appId}
        className={cn(
          'mx-auto flex w-[92px] justify-center rounded-[8px] py-2 transition-transform duration-200',
          isOccupied ? 'opacity-40' : 'hover:scale-105 active:scale-95'
        )}
        title={isOccupied ? t('miniApp.split.already_open') : undefined}>
        <MiniApp app={app} size={56} variant="launchpad" onOpen={openMiniAppInSplit} disabled={isOccupied} />
      </div>
    )
  }

  return (
    // `pointer-events-auto`: the page's split container is `pointer-events-none`
    // so pooled webviews stay clickable through it, which would leave this inert.
    <div className={cn('pointer-events-auto flex h-full min-h-0 flex-col bg-background', className)}>
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
        <div className="mx-auto flex w-full max-w-140 flex-col gap-3 py-8">
          <h2 className="m-0 px-4 py-0 font-semibold text-[14px] text-foreground opacity-80">
            {t('miniApp.split.choose')}
          </h2>
          <div className={GRID_CLASS}>{miniApps.map(renderMiniApp)}</div>
        </div>
      </Scrollbar>
    </div>
  )
}

export default SplitPanePicker

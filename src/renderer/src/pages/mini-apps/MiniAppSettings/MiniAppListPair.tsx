import { Button, Separator } from '@cherrystudio/ui'
import { ArrowLeftRight, RotateCcw } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import MiniAppListColumn from './MiniAppListColumn'
import MiniAppSettingsSection from './MiniAppSettingsSection'
import type { MiniAppVisibility } from './useMiniAppVisibility'

type Props = Pick<
  MiniAppVisibility,
  'visible' | 'hidden' | 'hide' | 'show' | 'reorderVisible' | 'reorderHidden' | 'swap' | 'reset'
>

/**
 * "Display management" group: visible and hidden lists side by side, sharing a
 * single compact height band. Swap / Reset are demoted to section-level
 * actions. State is supplied by the caller (via `useMiniAppVisibility`) so this
 * stays a pure view.
 */
const MiniAppListPair: FC<Props> = ({ visible, hidden, hide, show, reorderVisible, reorderHidden, swap, reset }) => {
  const { t } = useTranslation()
  return (
    <MiniAppSettingsSection
      title={t('settings.miniApps.group.display')}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={swap}>
            <ArrowLeftRight />
            {t('common.swap')}
          </Button>
          <Button variant="secondary" size="sm" onClick={reset}>
            <RotateCcw />
            {t('common.reset')}
          </Button>
        </>
      }>
      {/* Subtle gray well that bounds the list region. Grid with two
          minmax(0,1fr) tracks → the columns are always exactly equal width. */}
      <div className="grid h-64 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 overflow-hidden rounded-lg bg-muted/40 p-2">
        <MiniAppListColumn
          title={t('settings.miniApps.visible')}
          count={visible.length}
          apps={visible}
          onToggle={hide}
          onReorder={reorderVisible}
          toggleAction="hide"
        />
        <Separator orientation="vertical" />
        <MiniAppListColumn
          title={t('settings.miniApps.disabled')}
          count={hidden.length}
          apps={hidden}
          onToggle={show}
          onReorder={reorderHidden}
          toggleAction="show"
          emptyText={t('settings.miniApps.empty')}
        />
      </div>
    </MiniAppSettingsSection>
  )
}

export default MiniAppListPair

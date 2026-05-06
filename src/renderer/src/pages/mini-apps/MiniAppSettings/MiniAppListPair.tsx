import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import MiniAppListColumn from './MiniAppListColumn'
import type { MiniAppVisibility } from './useMiniAppVisibility'

type Props = Pick<MiniAppVisibility, 'visible' | 'hidden' | 'hide' | 'show' | 'reorderVisible' | 'reorderHidden'>

/**
 * Two-column visible / hidden mini-app list. State is supplied by the caller
 * (typically via `useMiniAppVisibility`) so the pair stays a pure view.
 */
const MiniAppListPair: FC<Props> = ({ visible, hidden, hide, show, reorderVisible, reorderHidden }) => {
  const { t } = useTranslation()
  return (
    <div className="flex h-72 gap-2">
      <MiniAppListColumn
        title={t('settings.miniapps.visible')}
        count={visible.length}
        apps={visible}
        onToggle={hide}
        onReorder={reorderVisible}
        toggleAction="hide"
      />
      <div className="w-px shrink-0 bg-border/30" />
      <MiniAppListColumn
        title={t('settings.miniapps.disabled')}
        count={hidden.length}
        apps={hidden}
        onToggle={show}
        onReorder={reorderHidden}
        toggleAction="show"
        emptyText={t('settings.miniapps.empty')}
      />
    </div>
  )
}

export default MiniAppListPair

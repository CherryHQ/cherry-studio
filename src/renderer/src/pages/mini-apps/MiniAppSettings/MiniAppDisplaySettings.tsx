import { Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import type { MiniAppRegionFilter } from '@shared/data/types/miniApp'
import { Slider } from 'antd'
import { Undo2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_MAX_KEEPALIVE = 3

/**
 * Bottom block of the display-settings drawer: region selector + open-link
 * external switch + max keep-alive slider + sidebar visibility switch.
 */
const MiniAppDisplaySettings: FC = () => {
  const { t } = useTranslation()
  const [maxKeepAlive, setMaxKeepAlive] = usePreference('feature.mini_app.max_keep_alive')
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    },
    []
  )

  const handleResetCacheLimit = useCallback(() => {
    void setMaxKeepAlive(DEFAULT_MAX_KEEPALIVE)
    window.toast.info(t('settings.miniApps.cache_change_notice'))
  }, [t, setMaxKeepAlive])

  const handleCacheChange = useCallback(
    (value: number) => {
      void setMaxKeepAlive(value)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        window.toast.info(t('settings.miniApps.cache_change_notice'))
        debounceTimerRef.current = null
      }, 500)
    },
    [t, setMaxKeepAlive]
  )

  return (
    <div className="mt-4 flex flex-col gap-3 border-border/30 border-t pt-3 text-[11px]">
      <RegionRow />

      <div className="flex items-center justify-between">
        <span className="text-foreground">{t('settings.miniApps.open_link_external.title')}</span>
        <Switch checked={openLinkExternal} onCheckedChange={(v) => setOpenLinkExternal(v)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col">
          <span className="text-foreground">{t('settings.miniApps.cache_title')}</span>
          <span className="text-[10px] text-muted-foreground/60">{t('settings.miniApps.cache_description')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content={t('settings.miniApps.reset_tooltip')}>
            <button
              type="button"
              onClick={handleResetCacheLimit}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-2xs border border-border/40 text-muted-foreground hover:text-foreground"
              aria-label={t('settings.miniApps.reset_tooltip')}>
              <Undo2 size={11} />
            </button>
          </Tooltip>
          <Slider
            className="flex-1"
            min={1}
            max={10}
            value={maxKeepAlive}
            onChange={handleCacheChange}
            tooltip={{ formatter: (value) => `${value}` }}
          />
          <span className="w-6 text-right text-[10px] text-muted-foreground/60">{maxKeepAlive}</span>
        </div>
      </div>
    </div>
  )
}

const RegionRow: FC = () => {
  const { t } = useTranslation()
  const [region = 'auto', setRegion] = usePreference('feature.mini_app.region')
  const options: { value: MiniAppRegionFilter; label: string }[] = [
    { value: 'auto', label: t('settings.miniApps.region.auto') },
    { value: 'CN', label: t('settings.miniApps.region.cn') },
    { value: 'Global', label: t('settings.miniApps.region.global') }
  ]
  return (
    <div className="flex items-center justify-between">
      <span className="text-foreground">{t('settings.miniApps.region.title')}</span>
      <Selector size={12} value={region} onChange={(v: MiniAppRegionFilter) => setRegion(v)} options={options} />
    </div>
  )
}

export default MiniAppDisplaySettings

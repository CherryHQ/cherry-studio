import { Button, Slider, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import type { MiniAppRegionFilter } from '@shared/data/types/miniApp'
import { Undo2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import MiniAppSettingsSection from './MiniAppSettingsSection'

const DEFAULT_MAX_KEEPALIVE = 3

interface PreferenceItemProps {
  title: string
  description?: string
  /** Inline control or trailing action shown on the title row. */
  action?: ReactNode
  /** Control rendered on its own row below the title (e.g. a wide slider). */
  children?: ReactNode
}

/** A single preference: title + description, with the control inline or below. */
const PreferenceItem: FC<PreferenceItemProps> = ({ title, description, action, children }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground text-sm">{title}</span>
        {description && <span className="text-muted-foreground text-xs">{description}</span>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </div>
)

/**
 * "Preferences" group of the display-settings drawer: region filter, open-link
 * external switch, and the max keep-alive slider. Every item follows the same
 * title + description + control structure.
 */
const MiniAppDisplaySettings: FC = () => {
  const { t } = useTranslation()
  const [maxKeepAlive, setMaxKeepAlive] = usePreference('feature.mini_app.max_keep_alive')
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')
  const [region = 'auto', setRegion] = usePreference('feature.mini_app.region')

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

  const regionOptions: { value: MiniAppRegionFilter; label: string }[] = [
    { value: 'auto', label: t('settings.miniApps.region.auto') },
    { value: 'CN', label: t('settings.miniApps.region.cn') },
    { value: 'Global', label: t('settings.miniApps.region.global') }
  ]

  return (
    <MiniAppSettingsSection title={t('settings.miniApps.group.preferences')}>
      {/* Roomier gap between items so each title + description block reads as its own unit. */}
      <div className="flex flex-col gap-5">
        <PreferenceItem
          title={t('settings.miniApps.region.title')}
          description={t('settings.miniApps.region.description')}
          action={
            <Selector
              size={14}
              value={region}
              onChange={(v: MiniAppRegionFilter) => setRegion(v)}
              options={regionOptions}
            />
          }
        />

        <PreferenceItem
          title={t('settings.miniApps.open_link_external.title')}
          description={t('settings.miniApps.open_link_external.description')}
          action={<Switch checked={openLinkExternal} onCheckedChange={(v) => setOpenLinkExternal(v)} />}
        />

        <PreferenceItem
          title={t('settings.miniApps.cache_title')}
          description={t('settings.miniApps.cache_description')}
          action={
            <Tooltip content={t('settings.miniApps.reset_tooltip')}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleResetCacheLimit}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t('settings.miniApps.reset_tooltip')}>
                <Undo2 />
              </Button>
            </Tooltip>
          }>
          <div className="flex items-center gap-3">
            <Slider
              className="flex-1"
              min={1}
              max={10}
              value={[maxKeepAlive ?? DEFAULT_MAX_KEEPALIVE]}
              onValueChange={(v) => handleCacheChange(v[0])}
              showValueLabel
            />
            <span className="w-6 text-right text-muted-foreground text-xs">{maxKeepAlive}</span>
          </div>
        </PreferenceItem>
      </div>
    </MiniAppSettingsSection>
  )
}

export default MiniAppDisplaySettings

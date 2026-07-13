import {
  Button,
  Combobox,
  InfoTooltip,
  PageSidePanelItem,
  PageSidePanelSection,
  Slider,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import type { MiniAppRegionFilter } from '@shared/data/types/miniApp'
import { Undo2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_MAX_KEEPALIVE = 3

/**
 * "Preferences" group of the display-settings drawer: region filter, open-link
 * external switch, and the max keep-alive slider. Every item pairs a title +
 * info tooltip with its control.
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
    toast.info(t('settings.miniApps.cache_change_notice'))
  }, [t, setMaxKeepAlive])

  const handleCacheChange = useCallback(
    (value: number) => {
      void setMaxKeepAlive(value)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        toast.info(t('settings.miniApps.cache_change_notice'))
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
    <PageSidePanelSection title={t('settings.miniApps.group.preferences')}>
      {/* Roomier gap between items so each title + description block reads as its own unit. */}
      <div className="flex flex-col gap-5">
        <PageSidePanelItem
          title={
            <span className="inline-flex items-center gap-1">
              {t('settings.miniApps.region.title')}
              <InfoTooltip content={t('settings.miniApps.region.description')} />
            </span>
          }
          action={
            <Combobox
              searchable={false}
              value={region}
              onChange={(value) => setRegion(value as MiniAppRegionFilter)}
              options={regionOptions}
              width={140}
            />
          }
        />

        <PageSidePanelItem
          title={
            <span className="inline-flex items-center gap-1">
              {t('settings.miniApps.open_link_external.title')}
              <InfoTooltip content={t('settings.miniApps.open_link_external.description')} />
            </span>
          }
          action={<Switch checked={openLinkExternal} onCheckedChange={(v) => setOpenLinkExternal(v)} />}
        />

        <PageSidePanelItem
          title={
            <span className="inline-flex items-center gap-1">
              {t('settings.miniApps.cache_title')}
              <InfoTooltip content={t('settings.miniApps.cache_description')} />
            </span>
          }
          action={
            <Tooltip content={t('settings.miniApps.reset_tooltip')}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleResetCacheLimit}
                className="shrink-0 text-foreground/80 hover:text-foreground [&_svg]:[stroke-width:var(--icon-stroke)]"
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
        </PageSidePanelItem>
      </div>
    </PageSidePanelSection>
  )
}

export default MiniAppDisplaySettings

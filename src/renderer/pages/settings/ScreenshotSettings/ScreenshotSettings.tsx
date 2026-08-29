import { Badge, Button, DescriptionSwitch, NormalTooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  SettingDivider,
  SettingGroup,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { isMac } from '@renderer/utils/platform'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_LOCAL_MODEL } from '@shared/data/presets/fileProcessing'
import type { OutputFor } from '@shared/ipc/types'
import { commandShortcutPreferenceKey } from '@shared/utils/command'
import { formatShortcutDisplay } from '@shared/utils/shortcut'
import { Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ScreenshotSettings')

const CAPTURE_SHORTCUT_KEY = commandShortcutPreferenceKey('screenshot.capture')

type ScreenCaptureStatus = OutputFor<'system.mac.screen_capture_status'>

type PermissionView = 'request' | 'denied' | 'prompt-unavailable' | 'restart-required'

const PERMISSION_HINT_KEYS = {
  request: 'settings.screenshot.permission.request_hint',
  denied: 'settings.screenshot.permission.denied_hint',
  'prompt-unavailable': 'settings.screenshot.permission.prompt_unavailable_hint',
  'restart-required': 'settings.screenshot.permission.restart_hint'
} as const

/**
 * Which permission state the section shows, or `null` to hide it entirely.
 *
 * `promptUnavailable` is separate from the status because a request that leaves the status
 * undecided means the OS dialog never appeared (typical for an unsigned dev binary) — the
 * user can still reach the grant through System Settings, but asking again is pointless.
 */
function resolvePermissionView(
  status: ScreenCaptureStatus | null,
  restartRequired: boolean,
  promptUnavailable: boolean
): PermissionView | null {
  if (!isMac || status === null) return null
  if (restartRequired) return 'restart-required'
  if (status === 'authorized') return null
  if (status === 'denied') return 'denied'
  if (promptUnavailable) return 'prompt-unavailable'
  return 'request'
}

const ScreenshotSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [screenshotEnabled, setScreenshotEnabled] = usePreference('feature.screenshot.enabled')
  const [autoOcr, setAutoOcr] = usePreference('feature.screenshot.auto_ocr')
  const [ocrProcessorId] = usePreference('feature.file_processing.default_image_to_text')
  const [effectiveOcrProcessorId, setEffectiveOcrProcessorId] = useState<FileProcessorId | null>(null)
  const [captureBinding] = usePreference('shortcut.screenshot.capture')
  const ocrModel = useLocalModel('ocr')

  const captureShortcut = formatShortcutDisplay(captureBinding.binding, isMac)
  const captureShortcutEnabled = captureBinding.enabled

  /**
   * Whether the OS refused to register the capture accelerator.
   *
   * Main only emits on the transition, so a page opened after the fact shows nothing —
   * the same limitation the shortcut list has. The case that matters is covered: turning
   * the feature on triggers the registration attempt while the user is looking at this row.
   */
  const [shortcutConflict, setShortcutConflict] = useState(false)
  useEffect(() => {
    return window.api.shortcut.onRegistrationConflict(({ key, hasConflict }) => {
      if (key === CAPTURE_SHORTCUT_KEY) setShortcutConflict(hasConflict)
    })
  }, [])

  const [permissionStatus, setPermissionStatus] = useState<ScreenCaptureStatus | null>(null)
  const [restartRequired, setRestartRequired] = useState(false)
  const [promptUnavailable, setPromptUnavailable] = useState(false)

  useEffect(() => {
    if (!isMac) return
    let mounted = true
    ipcApi
      .request('system.mac.screen_capture_status')
      .then((status) => {
        if (mounted) setPermissionStatus(status)
      })
      .catch((error) => logger.warn('Failed to read the screen recording permission status', error as Error))
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    setEffectiveOcrProcessorId(null)
    ipcApi
      .request('file_processing.configured_processor.get', { feature: 'image_to_text' })
      .then((processorId) => {
        if (mounted) setEffectiveOcrProcessorId(processorId)
      })
      .catch((error) => {
        if (mounted) setEffectiveOcrProcessorId(null)
        logger.warn('Failed to resolve the configured OCR processor', error as Error)
      })
    return () => {
      mounted = false
    }
  }, [ocrProcessorId])

  const requestPermission = () => {
    ipcApi
      .request('system.mac.request_screen_capture')
      .then((status) => {
        setPermissionStatus(status)
        // macOS applies a newly granted screen-recording permission only to a fresh process.
        setRestartRequired(status === 'authorized')
        setPromptUnavailable(status === 'not-determined')
      })
      .catch((error) => logger.warn('Screen recording permission request failed', error as Error))
  }

  const openSystemSettings = () => {
    ipcApi
      .request('system.mac.open_screen_capture_settings')
      .catch((error) => logger.warn('Failed to open the screen recording settings pane', error as Error))
  }

  const relaunch = () => {
    ipcApi.request('app.relaunch').catch((error) => logger.warn('Failed to relaunch the app', error as Error))
  }

  const permissionView = resolvePermissionView(permissionStatus, restartRequired, promptUnavailable)
  const supportsScreenshotGeometry = effectiveOcrProcessorId === 'local-paddleocr'
  const requiresLocalOcrModel =
    effectiveOcrProcessorId !== null && FILE_PROCESSOR_LOCAL_MODEL[effectiveOcrProcessorId] === 'ocr'
  const ocrReady = supportsScreenshotGeometry && (!requiresLocalOcrModel || ocrModel.status === 'ready')

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.screenshot.title')}</SettingTitle>
        <SettingDivider />
        <DescriptionSwitch
          size="sm"
          label={t('settings.screenshot.enable.title')}
          description={t('settings.screenshot.enable.description')}
          checked={screenshotEnabled}
          onCheckedChange={(checked) => void setScreenshotEnabled(checked)}
        />

        {permissionView && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0">
              <p className="text-foreground text-sm">{t('settings.screenshot.permission.title')}</p>
              <p className="mt-1 text-muted-foreground text-xs leading-5">{t(PERMISSION_HINT_KEYS[permissionView])}</p>
            </div>
            {permissionView === 'restart-required' ? (
              <Button size="sm" className="shrink-0" onClick={relaunch}>
                {t('settings.screenshot.permission.restart')}
              </Button>
            ) : permissionView === 'request' ? (
              <Button size="sm" variant="outline" className="shrink-0" onClick={requestPermission}>
                {t('settings.screenshot.permission.grant')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="shrink-0" onClick={openSystemSettings}>
                {t('settings.screenshot.permission.open_settings')}
              </Button>
            )}
          </div>
        )}

        <SettingDivider />
        {/* Mirrors DescriptionSwitch's own markup (p-2, gap-1, size="sm" type scale) so this
            row lines up with the switches above it — there is no read-only variant to reuse. */}
        <div className="flex w-full justify-between gap-3 p-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium text-sm leading-4 tracking-normal">{t('settings.screenshot.shortcut.title')}</p>
            <span className="text-[10px] text-muted-foreground leading-3">
              {t('settings.screenshot.shortcut.description')}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {captureShortcut ? (
              <>
                {/* The badge alone would read as "bound, therefore working" — the whole
                    point of this state is that the binding exists and does nothing. */}
                {shortcutConflict && (
                  <NormalTooltip content={t('settings.shortcuts.occupied_by_other_application')}>
                    {/* aria-label because lucide icons are aria-hidden and a tooltip is not
                        an accessible name — the warning would exist only for sighted users. */}
                    <TriangleAlert
                      aria-label={t('settings.shortcuts.occupied_by_other_application')}
                      className="size-4 shrink-0 text-destructive"
                    />
                  </NormalTooltip>
                )}
                <Badge variant={captureShortcutEnabled ? 'default' : 'outline'}>{captureShortcut}</Badge>
                {/* Spelled out, not left to the badge variant: nobody reads filled-vs-outline
                    as on-vs-off, and a bound-but-disabled shortcut looks like a working one. */}
                {!captureShortcutEnabled && (
                  <span className="text-muted-foreground text-xs">{t('settings.screenshot.shortcut.disabled')}</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground text-xs">{t('settings.screenshot.shortcut.unset')}</span>
            )}
            {/* Carries the command id so the shortcut page scrolls to this row instead of
                dropping the user at the top of a long list. */}
            <Link
              to="/settings/shortcut"
              search={{ command: 'screenshot.capture' }}
              className="text-link text-xs hover:underline">
              {t('settings.screenshot.shortcut.link')}
            </Link>
          </div>
        </div>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.screenshot.ocr.title')}</SettingTitle>
        <SettingDivider />
        <DescriptionSwitch
          size="sm"
          label={t('settings.screenshot.ocr.auto.title')}
          description={t('settings.screenshot.ocr.auto.description')}
          checked={autoOcr}
          disabled={!ocrReady}
          onCheckedChange={(checked) => void setAutoOcr(checked)}
        />

        <div className="mt-2 px-2">
          {ocrReady ? (
            <Badge variant="secondary">{t('settings.screenshot.ocr.model.ready')}</Badge>
          ) : requiresLocalOcrModel && ocrModel.status === 'downloading' ? (
            <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
              <span>{t('settings.screenshot.ocr.model.downloading')}</span>
              <span>{ocrModel.percent}%</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs leading-5">
                {t('settings.screenshot.ocr.model.unavailable')}
              </span>
              <Link to="/settings/local-models" className="shrink-0 text-link text-xs hover:underline">
                {t('settings.screenshot.ocr.model.link')}
              </Link>
            </div>
          )}
        </div>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default ScreenshotSettings

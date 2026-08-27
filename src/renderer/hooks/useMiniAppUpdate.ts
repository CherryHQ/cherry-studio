import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useMiniAppUpdate')

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** An update that carries a token — the two shapes the review surfaces can render. */
export type UpdateOffer = Exclude<OutputFor<'mini_app.update.check'>, { status: 'current' }>

/** The review dialog's answer: the added required leaves and hosts accepted, the offered optional leaves left ticked. */
export interface UpdateDecision {
  consented: boolean
  grantedOptional: string[]
}

/**
 * Check → review → apply, for every host that offers an update: the tile's menu, the
 * panel's "new version" chip and its "check for updates" button. The renderer holds no
 * update state beyond the token the check returned; a check is always fresh because the
 * token expires and the dot may be hours old.
 */
export function useMiniAppUpdate(
  appId: string,
  options: { name: string; onApplied?: () => void; onChecked?: () => void }
) {
  const { t } = useTranslation()
  const [offer, setOffer] = useState<UpdateOffer | null>(null)
  /** The last check found nothing — the panel says so, the tile has nothing to say. */
  const [current, setCurrent] = useState(false)
  const [busy, setBusy] = useState(false)

  const check = async () => {
    setBusy(true)
    setCurrent(false)
    try {
      const status = await ipcApi.request('mini_app.update.check', { appId })
      if (status.status === 'current') {
        setOffer(null)
        setCurrent(true)
      } else {
        setOffer(status)
      }
      // A check can change the version the host reports (a newer one published since the dot lit).
      options.onChecked?.()
    } catch (e) {
      logger.error('Mini app update check failed', e as Error)
      toast.error(t('miniApp.detail.action_error', { message: errorMessage(e) }))
    } finally {
      setBusy(false)
    }
  }

  const apply = async (decision: UpdateDecision) => {
    if (!offer) return
    const { updateToken, addedOptional, version } = offer
    // Busy FIRST: the hosts render the dialog behind `offer &&`, so clearing the offer here
    // would unmount it before it ever saw `busy`, and the download and publish would run
    // with the dialog already gone and nothing on screen saying so.
    setBusy(true)
    try {
      await ipcApi.request('mini_app.update.apply', {
        appId,
        updateToken,
        ...(decision.consented ? { consented: true } : {}),
        ...(addedOptional.length > 0 ? { grantedOptional: decision.grantedOptional } : {})
      })
      toast.success(t('miniApp.install.upgrade_success', { name: options.name, version }))
      options.onApplied?.()
    } catch (e) {
      logger.error('Mini app update failed', e as Error)
      toast.error(t('miniApp.detail.action_error', { message: errorMessage(e) }))
    } finally {
      // Consumed either way: main deletes the review on `consume`, so the token is spent
      // even when the publish failed and a retry has to re-check. Dropped HERE rather than
      // up front, so the dialog stays mounted — and busy — for the whole request.
      setOffer(null)
      setBusy(false)
    }
  }

  const dismiss = () => setOffer(null)

  return { offer, current, busy, check, apply, dismiss }
}

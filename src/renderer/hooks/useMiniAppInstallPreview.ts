import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'
import { resolveLocalizedText } from '@shared/types/miniAppManifest'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** The card's input — an install (fresh or reinstall) or an upgrade, as main decided by version. */
export type InstallPreview = OutputFor<'mini_app.install.preview_url'>

/** Translated at render so the settle handler needs nothing from the current render. */
export interface PreviewError {
  key: string
  params?: Record<string, string>
}

/** The card's answer. */
export interface InstallDecision {
  /** The optional leaves (declared, or newly offered by an upgrade) still ticked. */
  grantedOptional: string[]
  /** Reinstall only: wipe what the app wrote before the package lands. */
  clearData?: boolean
  /** Upgrade only: the added required leaves and hosts were accepted. */
  consented?: boolean
}

const logger = loggerService.withContext('useMiniAppInstallPreview')

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Fire-and-forget: the ledger entry is idempotent to drop, and nothing awaits it. */
const releasePending = async (installToken: string) => {
  try {
    await ipcApi.request('mini_app.install.cancel_preview', { installToken })
  } catch (e) {
    logger.warn('cancel_preview failed', e as Error)
  }
}

/**
 * The two-phase install, minus any markup: preview (file / url / builtin) → consent →
 * confirm by token. Owns the install token main is holding and releases it on cancel,
 * on a late-settling preview, and on unmount — every host shares exactly this. An
 * upgrade preview carries an update token instead, which expires on its own.
 *
 * `expectAppId` pins the preview to one app — the detail panel's "replace package"
 * must not install whatever file the user happened to pick.
 */
export function useMiniAppInstallPreview(onDone: () => void, options: { expectAppId?: string } = {}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const [preview, setPreview] = useState<InstallPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<PreviewError | null>(null)
  // The install token main is holding for this host; cleared once consumed or released.
  const tokenRef = useRef<string | null>(null)
  // Set on unmount so a preview that settles late is released, not shown.
  const closedRef = useRef(false)
  const expectAppId = options.expectAppId

  useEffect(() => {
    closedRef.current = false
    return () => {
      closedRef.current = true
      if (tokenRef.current) {
        void releasePending(tokenRef.current)
        tokenRef.current = null
      }
    }
  }, [])

  /**
   * The ONE settle handler for all three sources. A result arriving after close is
   * released, never shown; a preview main superseded with a newer one is dropped in
   * silence — the newer state is the one the user is looking at.
   */
  const settle = useCallback(
    async (run: () => Promise<InstallPreview | null>, errorKey: string) => {
      setBusy(true)
      setError(null)
      try {
        const result = await run()
        if (!result) return
        const release = () => {
          if (result.kind === 'install') void releasePending(result.installToken)
        }
        if (closedRef.current) {
          release()
          return
        }
        if (expectAppId && result.manifest.id !== expectAppId) {
          release()
          setError({ key: 'miniApp.install.wrong_app', params: { id: result.manifest.id, expected: expectAppId } })
          return
        }
        tokenRef.current = result.kind === 'install' ? result.installToken : null
        setPreview(result)
      } catch (e) {
        if (closedRef.current || /superseded/i.test(errorMessage(e))) return
        logger.error('Failed to preview mini app', e as Error)
        setError({ key: errorKey, params: { message: errorMessage(e) } })
      } finally {
        if (!closedRef.current) setBusy(false)
      }
    },
    [expectAppId]
  )

  /** Back to the host: the consent is withdrawn, the host stays open. */
  const cancelPreview = () => {
    if (tokenRef.current) {
      void releasePending(tokenRef.current)
      tokenRef.current = null
    }
    setPreview(null)
  }

  const confirm = async (decision: InstallDecision) => {
    if (!preview) return
    const name = resolveLocalizedText(preview.manifest.name, language)
    setBusy(true)
    setError(null)
    // Consumed either way: main deletes the entry on `take` / `consume`, so a retry needs a new preview.
    const installToken = tokenRef.current
    tokenRef.current = null
    try {
      if (preview.kind === 'upgrade') {
        const { update } = preview
        await ipcApi.request('mini_app.update.apply', {
          appId: preview.appId,
          updateToken: update.updateToken,
          ...(decision.consented ? { consented: true } : {}),
          ...(update.addedOptional.length > 0 ? { grantedOptional: decision.grantedOptional } : {})
        })
        toast.success(t('miniApp.install.upgrade_success', { name, version: update.version }))
      } else {
        if (!installToken) return
        await ipcApi.request('mini_app.install.confirm', {
          installToken,
          grantedOptional: decision.grantedOptional,
          ...(preview.installed ? { reinstall: { clearData: decision.clearData === true } } : {})
        })
        toast.success(t(preview.installed ? 'miniApp.install.reinstall_success' : 'miniApp.install.success', { name }))
      }
      setPreview(null)
      onDone()
    } catch (e) {
      logger.error('Failed to install mini app package', e as Error)
      setPreview(null)
      setError({ key: 'miniApp.install.install_error', params: { message: errorMessage(e) } })
    } finally {
      if (!closedRef.current) setBusy(false)
    }
  }

  return { preview, busy, error, settle, cancelPreview, confirm }
}

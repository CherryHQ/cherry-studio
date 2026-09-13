import { useCallback, useEffect, useRef } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('useNutstoreSso')
const NUTSTORE_SSO_TIMEOUT_MS = 5 * 60 * 1000

export type NutstoreSsoFailureReason = 'launch' | 'listen' | 'timeout' | 'invalid_callback'

export type NutstoreSsoOutcome =
  | { status: 'success'; token: string }
  | { status: 'error'; reason: NutstoreSsoFailureReason }

export function useNutstoreSso() {
  const cancelPendingAttemptRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      cancelPendingAttemptRef.current?.()
      cancelPendingAttemptRef.current = null
    }
  }, [])

  const nutstoreSsoHandler = useCallback(() => {
    cancelPendingAttemptRef.current?.()

    return new Promise<NutstoreSsoOutcome>((resolve) => {
      const resources: { removeListener?: () => void; timeoutId?: number } = {}
      let settled = false

      const release = () => {
        settled = true
        resources.removeListener?.()
        if (resources.timeoutId !== undefined) window.clearTimeout(resources.timeoutId)
        if (cancelPendingAttemptRef.current === cancel) {
          cancelPendingAttemptRef.current = null
        }
      }

      const finish = (outcome: NutstoreSsoOutcome) => {
        if (settled) return
        release()
        resolve(outcome)
      }

      // 取消（被新尝试替换、组件卸载）不结算：调用方不该为一次主动放弃的尝试报错
      const cancel = () => {
        if (settled) return
        release()
      }
      cancelPendingAttemptRef.current = cancel

      const onProtocolData = (data: { url: string }) => {
        let url: URL
        try {
          url = new URL(data.url)
        } catch (error) {
          logger.warn('Ignored malformed protocol URL during Nutstore SSO', error as Error)
          return
        }

        const isSchemeRoot = url.hostname === '' && (url.pathname === '' || url.pathname === '/')
        if (url.protocol !== 'cherrystudio:' || !isSchemeRoot) return

        const encryptedToken = url.searchParams.get('s')
        if (!encryptedToken) {
          if (!url.searchParams.has('error')) return
          logger.warn('Nutstore SSO callback did not contain an authorization token')
          finish({ status: 'error', reason: 'invalid_callback' })
          return
        }
        finish({ status: 'success', token: encryptedToken })
      }

      try {
        const unsubscribe = ipcApi.on('navigation.protocol_data', onProtocolData)
        resources.removeListener = unsubscribe
        if (settled) unsubscribe()
      } catch (error) {
        logger.error('Failed to listen for Nutstore SSO callback', error as Error)
        finish({ status: 'error', reason: 'listen' })
        return
      }

      const timer = window.setTimeout(() => {
        logger.warn('Nutstore SSO timed out')
        finish({ status: 'error', reason: 'timeout' })
      }, NUTSTORE_SSO_TIMEOUT_MS)
      resources.timeoutId = timer
      if (settled) window.clearTimeout(timer)

      const failLaunch = (error: unknown) => {
        logger.error('Failed to launch Nutstore SSO authorization', error as Error)
        finish({ status: 'error', reason: 'launch' })
      }

      const launchAuthorization = async () => {
        try {
          const ssoUrl = await window.api.nutstore.getSSOUrl()
          if (settled) return
          await ipcApi.request('system.shell.open_website', ssoUrl)
        } catch (error) {
          if (!settled) failLaunch(error)
        }
      }

      void launchAuthorization()
    })
  }, [])

  return nutstoreSsoHandler
}

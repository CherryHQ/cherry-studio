import { useCallback, useEffect, useRef } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('useNutstoreSso')
const NUTSTORE_SSO_TIMEOUT_MS = 5 * 60 * 1000

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

    return new Promise<string | null>((resolve) => {
      let removeListener: (() => void) | undefined
      // eslint-disable-next-line prefer-const -- A synchronous subscription callback can release resources before the timer is allocated.
      let timeoutId: number | undefined
      let settled = false

      const release = () => {
        settled = true
        removeListener?.()

        if (timeoutId !== undefined) window.clearTimeout(timeoutId)

        if (cancelPendingAttemptRef.current === cancel) {
          cancelPendingAttemptRef.current = null
        }
      }

      const finish = (encryptedToken: string | null) => {
        if (settled) return
        release()
        resolve(encryptedToken)
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

        const encryptedToken = url.searchParams.get('s')
        const isSchemeRoot = url.hostname === '' && (url.pathname === '' || url.pathname === '/')
        const isNutstoreSso = url.hostname === 'nutstore-sync' && url.pathname === '/sso'

        if (url.protocol !== 'cherrystudio:' || !(isSchemeRoot || isNutstoreSso) || !encryptedToken) return
        finish(encryptedToken)
      }

      try {
        const unsubscribe = ipcApi.on('navigation.protocol_data', onProtocolData)
        removeListener = unsubscribe

        if (settled) unsubscribe()
      } catch (error) {
        logger.error('Failed to listen for Nutstore SSO callback', error as Error)
        finish(null)

        return
      }

      const timer = window.setTimeout(() => {
        logger.warn('Nutstore SSO timed out')
        finish(null)
      }, NUTSTORE_SSO_TIMEOUT_MS)

      timeoutId = timer

      if (settled) window.clearTimeout(timer)
    })
  }, [])

  return nutstoreSsoHandler
}

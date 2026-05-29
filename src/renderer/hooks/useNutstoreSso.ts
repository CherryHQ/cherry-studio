import { loggerService } from '@logger'
import { useCallback } from 'react'

const logger = loggerService.withContext('useNutstoreSso')

export function useNutstoreSso() {
  const nutstoreSsoHandler = useCallback(() => {
    return new Promise<string>((resolve, reject) => {
      const removeListener = window.api.protocol.onReceiveData(async (data) => {
        try {
          const url = new URL(data.url)
          const params = new URLSearchParams(url.search)
          const encryptedToken = params.get('s')
          if (!encryptedToken) return reject(null)
          resolve(encryptedToken)
        } catch (error) {
          logger.error('解析URL失败:', error as Error)
          reject(null)
        } finally {
          removeListener()
        }
      })
    })
  }, [])

  return nutstoreSsoHandler
}

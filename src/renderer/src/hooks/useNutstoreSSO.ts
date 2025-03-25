import { useCallback } from 'react'

export function useNutstoreSSO() {
  const nutstoreSSOHandler = useCallback(() => {
    return new Promise<string>((resolve, reject) => {
      const removeListener = window.api.protocol.onReceiveData(async (data) => {
        try {
          const url = new URL(data.url)
          const params = new URLSearchParams(url.search)
          const encryptedToken = params.get('s')
          if (!encryptedToken) return reject(null)
          resolve(encryptedToken)
        } catch (error) {
          console.error('解析URL失败:', error)
          reject(null)
        } finally {
          removeListener()
        }
      })
    })
  }, [])

  return nutstoreSSOHandler
}

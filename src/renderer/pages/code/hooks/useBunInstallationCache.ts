import { usePersistCache } from '@renderer/data/hooks/useCache'
import { loggerService } from '@renderer/services/LoggerService'
import { useEffect } from 'react'

const logger = loggerService.withContext('useBunInstallationCache')

export function useBunInstallationCache(): void {
  const [, setIsBunInstalled] = usePersistCache('feature.mcp.is_bun_installed')

  // Refresh the shared MCP bun-presence cache once on mount (MCP relies on it).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const bunExists = await window.api.isBinaryExist('bun')
        if (!cancelled) setIsBunInstalled(bunExists)
      } catch (error) {
        logger.error('Failed to check bun installation status:', error as Error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setIsBunInstalled])
}

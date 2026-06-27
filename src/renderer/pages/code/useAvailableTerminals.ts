import { loggerService } from '@logger'
import { isMac, isWin } from '@renderer/config/constant'
import type { TerminalConfig } from '@shared/types/codeCli'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useAvailableTerminals')

/**
 * Available terminal apps (macOS/Windows only). Loaded once on mount; returns
 * an empty list on Linux or on fetch failure.
 */
export function useAvailableTerminals(): TerminalConfig[] {
  const [terminals, setTerminals] = useState<TerminalConfig[]>([])

  useEffect(() => {
    if (!isMac && !isWin) return
    let cancelled = false
    window.api.codeCli
      .getAvailableTerminals()
      .then((result) => {
        if (!cancelled) setTerminals(result)
      })
      .catch((error) => {
        logger.error('Failed to load available terminals:', error as Error)
        if (!cancelled) setTerminals([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return terminals
}

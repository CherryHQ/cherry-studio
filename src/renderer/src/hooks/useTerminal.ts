import { useCallback, useEffect, useRef, useState } from 'react'

interface UseTerminalOptions {
  sessionId: string
  cwd?: string
  visible: boolean
}

interface UseTerminalReturn {
  terminalReady: boolean
  error: string | null
  restart: () => void
}

export function useTerminal({ sessionId, cwd, visible }: UseTerminalOptions): UseTerminalReturn {
  const [terminalReady, setTerminalReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terminalCreatedRef = useRef(false)

  const createTerminal = useCallback(async () => {
    if (!sessionId || terminalCreatedRef.current) return

    try {
      const result = await window.api.terminal.create(sessionId, cwd, 80, 24)
      if (result.success) {
        setTerminalReady(true)
        setError(null)
        terminalCreatedRef.current = true
      } else {
        setError(result.error || 'Failed to create terminal')
        setTerminalReady(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setTerminalReady(false)
    }
  }, [sessionId, cwd])

  // Create terminal when panel becomes visible
  useEffect(() => {
    if (!visible || !sessionId) return
    void createTerminal()
  }, [visible, sessionId, createTerminal])

  // Cleanup terminal when hook unmounts (session switches or component removed)
  useEffect(() => {
    return () => {
      if (sessionId) {
        window.api.terminal.kill(sessionId).catch(() => {})
      }
    }
  }, [sessionId])

  const restart = useCallback(() => {
    if (sessionId) {
      window.api.terminal.kill(sessionId).catch(() => {})
    }
    terminalCreatedRef.current = false
    setTerminalReady(false)
    setError(null)
    void createTerminal()
  }, [sessionId, createTerminal])

  return { terminalReady, error, restart }
}

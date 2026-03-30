import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef } from 'react'

interface TerminalPanelProps {
  sessionId: string
  cwd?: string
  visible: boolean
  onError: (error: string | null) => void
  onExited: () => void
}

const TerminalPanel = ({ sessionId, cwd, visible, onError, onExited }: TerminalPanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const terminalCreatedRef = useRef(false)

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || !sessionId || terminalCreatedRef.current) return

    const result = await window.api.terminal.create(sessionId, cwd, 80, 24)
    if (!result.success) {
      onError(result.error || 'Failed to create terminal')
      return
    }

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4'
      }
    })

    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(containerRef.current)

    // Small delay to ensure container is properly sized
    setTimeout(() => {
      try {
        fitAddon.fit()
      } catch {
        // ignore
      }
    }, 50)

    // Handle user input
    const inputDisposable = xterm.onData((data) => {
      window.api.terminal.write(sessionId, data)
    })

    // Listen for PTY output
    const cleanupData = window.api.terminal.onData((event) => {
      if (event.sessionId !== sessionId) return
      if (xtermRef.current) {
        xtermRef.current.write(event.data)
      }
      if (event.exited) {
        terminalCreatedRef.current = false
        onExited()
      }
    })

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    cleanupDataRef.current = () => {
      cleanupData()
      inputDisposable.dispose()
    }
    terminalCreatedRef.current = true
    onError(null)
  }, [sessionId, cwd, onError, onExited])

  // Create terminal when panel becomes visible
  useEffect(() => {
    if (visible && sessionId) {
      initTerminal()
    }
  }, [visible, sessionId, initTerminal])

  // Handle resize
  useEffect(() => {
    if (!visible) return

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims) {
            window.api.terminal.resize(sessionId, dims.cols, dims.rows)
          }
        } catch {
          // ignore resize errors
        }
      }
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [visible, sessionId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupDataRef.current?.()
      xtermRef.current?.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      terminalCreatedRef.current = false
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e2e',
        padding: '4px 8px'
      }}
    />
  )
}

export default TerminalPanel

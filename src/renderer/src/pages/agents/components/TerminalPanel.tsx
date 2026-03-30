import '@xterm/xterm/css/xterm.css'

import { useTheme } from '@renderer/context/ThemeProvider'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface TerminalPanelProps {
  sessionId: string
  cwd?: string
  visible: boolean
  onError: (error: string | null) => void
  onExited: () => void
}

const TerminalPanel = ({ sessionId, cwd, visible, onError, onExited }: TerminalPanelProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const terminalCreatedRef = useRef(false)
  const sessionIdRef = useRef(sessionId)

  const isDark = theme === 'dark'

  const disposeTerminal = useCallback((terminalSessionId?: string) => {
    cleanupDataRef.current?.()
    cleanupDataRef.current = null
    xtermRef.current?.dispose()
    xtermRef.current = null
    fitAddonRef.current = null
    terminalCreatedRef.current = false

    if (terminalSessionId) {
      void window.api.terminal.kill(terminalSessionId).catch(() => {})
    }
  }, [])

  // Build xterm theme from CSS variables
  const buildTheme = useCallback(() => {
    if (isDark) {
      return {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff'
      }
    }
    // Light theme - VS Code Light+ inspired
    return {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      cursorAccent: '#ffffff',
      selectionBackground: '#add6ff',
      selectionForeground: '#000000',
      black: '#000000',
      red: '#cd3131',
      green: '#00bc00',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#14ce14',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    }
  }, [isDark])

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || !sessionId || terminalCreatedRef.current) return

    const result = await window.api.terminal.create(sessionId, cwd, 80, 24)
    if (!result.success) {
      onError(result.error || t('code.launch.error'))
      return
    }

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: buildTheme(),
      scrollback: 10000
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
      void window.api.terminal.write(sessionId, data)
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
    sessionIdRef.current = sessionId
    onError(null)
  }, [sessionId, cwd, buildTheme, onError, onExited, t])

  // Create terminal when panel becomes visible
  useEffect(() => {
    if (visible && sessionId) {
      void initTerminal()
    }
  }, [visible, sessionId, initTerminal])

  // Update xterm theme when app theme changes
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = buildTheme()
    }
  }, [buildTheme])

  // Handle resize
  useEffect(() => {
    if (!visible) return

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims) {
            void window.api.terminal.resize(sessionId, dims.cols, dims.rows)
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

  useEffect(() => {
    sessionIdRef.current = sessionId

    return () => {
      disposeTerminal(sessionIdRef.current)
    }
  }, [sessionId, disposeTerminal])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
        padding: '4px 8px'
      }}
    />
  )
}

export default TerminalPanel

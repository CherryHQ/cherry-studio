/**
 * Hermes tool progress indicator.
 *
 * Displays a compact list of currently-running tools from the Hermes agent,
 * using the `hermes.tool.progress` SSE events forwarded via IPC.
 *
 * Lifecycle:
 *   running  → spinner + emoji + label
 *   completed → ✅ + emoji + label, then fade-out after 2s and auto-remove
 *
 * The outer wrapper always renders (even when empty) so the height collapse
 * is driven by CSS max-height/opacity transitions rather than a DOM removal,
 * preventing layout jitter.
 */

import { IpcChannel } from '@shared/IpcChannel'
import type { HermesToolProgressEvent } from '@shared/types/hermes'
import { type FC, useEffect, useRef, useState } from 'react'

interface ActiveTool {
  toolCallId: string
  tool: string
  emoji: string
  label: string
  startedAt: number
  completedAt: number | null
}

/** How long a completed tool stays visible before fading out. */
const COMPLETED_LINGER_MS = 2000
/** Fade-out animation duration. */
const FADE_DURATION_MS = 300
/** Stale timeout for running tools that never complete. */
const STALE_TIMEOUT_MS = 5 * 60 * 1000

export const HermesToolProgressIndicator: FC = () => {
  const [activeTools, setActiveTools] = useState<Map<string, ActiveTool>>(new Map())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const tools = Array.from(activeTools.values())
  const hasTools = tools.length > 0

  // IPC listener
  useEffect(() => {
    const handler = (_event: Electron.IpcRendererEvent, data: HermesToolProgressEvent) => {
      setActiveTools((prev) => {
        const next = new Map(prev)
        if (data.status === 'running') {
          // Cancel any lingering removal if the same tool is re-used
          const existing = timersRef.current.get(data.toolCallId)
          if (existing) {
            clearTimeout(existing)
            timersRef.current.delete(data.toolCallId)
          }
          next.set(data.toolCallId, {
            toolCallId: data.toolCallId,
            tool: data.tool,
            emoji: data.emoji ?? '⚡',
            label: data.label ?? data.tool,
            startedAt: Date.now(),
            completedAt: null
          })
        } else if (data.status === 'completed') {
          const tool = next.get(data.toolCallId)
          if (tool) {
            // Mark completed, schedule removal after linger
            next.set(data.toolCallId, { ...tool, completedAt: Date.now() })
            const timer = setTimeout(() => {
              setActiveTools((current) => {
                const updated = new Map(current)
                updated.delete(data.toolCallId)
                return updated
              })
              timersRef.current.delete(data.toolCallId)
            }, COMPLETED_LINGER_MS + FADE_DURATION_MS)
            timersRef.current.set(data.toolCallId, timer)
          }
        }
        return next
      })
    }
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.Hermes_ToolProgress, handler)
    return () => cleanup()
  }, [])

  // Sweep stale running tools
  useEffect(() => {
    if (!hasTools) return
    const timer = setInterval(() => {
      setActiveTools((prev) => {
        const now = Date.now()
        const next = new Map(prev)
        for (const [id, tool] of next) {
          if (tool.completedAt === null && now - tool.startedAt > STALE_TIMEOUT_MS) {
            next.delete(id)
          }
        }
        return next.size === prev.size ? prev : next
      })
    }, 30_000)
    return () => clearInterval(timer)
  }, [hasTools])

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t)
      timersRef.current.clear()
    }
  }, [])

  return (
    <div
      style={{
        maxHeight: hasTools ? 200 : 0,
        opacity: hasTools ? 1 : 0,
        overflow: 'hidden',
        transition: `max-height ${FADE_DURATION_MS}ms ease-out, opacity ${FADE_DURATION_MS}ms ease-out`
      }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 12px',
          padding: '6px 10px',
          marginTop: 4,
          borderRadius: 8,
          background: 'var(--color-background-soft, rgba(255,255,255,0.04))',
          border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--color-text-secondary, rgba(255,255,255,0.55))'
        }}>
        {tools.map((tool) => {
          const isCompleted = tool.completedAt !== null
          const isFadingOut =
            isCompleted && tool.completedAt !== null && Date.now() - tool.completedAt > COMPLETED_LINGER_MS

          return (
            <span
              key={tool.toolCallId}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                opacity: isFadingOut ? 0 : 1,
                transition: `opacity ${FADE_DURATION_MS}ms ease-out`
              }}>
              <span style={{ fontSize: 13 }}>{tool.emoji}</span>
              <span>{tool.label}</span>
              {isCompleted ? (
                <span style={{ fontSize: 12, color: 'var(--color-success, #22c55e)' }}>✓</span>
              ) : (
                <span
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    border: '1.5px solid currentColor',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'hermes-spin 0.8s linear infinite'
                  }}
                />
              )}
            </span>
          )
        })}
        <style>{`
          @keyframes hermes-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}

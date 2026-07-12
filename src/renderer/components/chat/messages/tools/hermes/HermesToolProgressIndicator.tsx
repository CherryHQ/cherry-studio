/**
 * Hermes tool progress indicator.
 *
 * Displays a compact list of currently-running tools from the Hermes agent,
 * using the `hermes.tool.progress` SSE events forwarded via IPC.
 *
 * Renders as a subtle inline status bar below the placeholder text:
 *   🔍 Searching the web...  📄 Reading file...
 *
 * Exit: instant removal (no fade animation). The parent PlaceholderBlock
 * is itself replaced by real content on the same frame, so any animation
 * here would cause a double-layout-shift. Instant removal keeps the
 * transition atomic.
 */

import { IpcChannel } from '@shared/IpcChannel'
import type { HermesToolProgressEvent } from '@shared/types/hermes'
import { type FC, useEffect, useState } from 'react'

interface ActiveTool {
  toolCallId: string
  tool: string
  emoji: string
  label: string
  startedAt: number
}

const STALE_TIMEOUT_MS = 5 * 60 * 1000

export const HermesToolProgressIndicator: FC = () => {
  const [activeTools, setActiveTools] = useState<Map<string, ActiveTool>>(new Map())

  const tools = Array.from(activeTools.values())

  // IPC listener
  useEffect(() => {
    const handler = (_event: Electron.IpcRendererEvent, data: HermesToolProgressEvent) => {
      setActiveTools((prev) => {
        const next = new Map(prev)
        if (data.status === 'running') {
          next.set(data.toolCallId, {
            toolCallId: data.toolCallId,
            tool: data.tool,
            emoji: data.emoji ?? '⚡',
            label: data.label ?? data.tool,
            startedAt: Date.now()
          })
        } else if (data.status === 'completed') {
          next.delete(data.toolCallId)
        }
        return next
      })
    }
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.Hermes_ToolProgress, handler)
    return () => cleanup()
  }, [])

  // Auto-clear stale tools
  useEffect(() => {
    if (tools.length === 0) return
    const timer = setInterval(() => {
      setActiveTools((prev) => {
        const now = Date.now()
        const next = new Map(prev)
        for (const [id, tool] of next) {
          if (now - tool.startedAt > STALE_TIMEOUT_MS) next.delete(id)
        }
        return next.size === prev.size ? prev : next
      })
    }, 30_000)
    return () => clearInterval(timer)
  }, [tools.length])

  if (tools.length === 0) return null

  return (
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
      {tools.map((tool) => (
        <span key={tool.toolCallId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 13 }}>{tool.emoji}</span>
          <span>{tool.label}</span>
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
        </span>
      ))}
      <style>{`
        @keyframes hermes-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

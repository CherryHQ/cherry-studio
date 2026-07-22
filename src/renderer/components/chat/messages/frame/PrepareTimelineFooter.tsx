import { Button } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import {
  buildPrepareDiagnostics,
  PREPARE_TIMELINE_FOOTER_THRESHOLD_MS,
  type PrepareProgressPartData,
  type PrepareTimeline
} from '@shared/ai/agentPrepareTimeline'
import type { CherryMessagePart } from '@shared/data/types/message'
import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Return the finalized prepare timeline worth surfacing in the footer — present only when a
 * `data-prepare-progress` part carries a finalized `timeline` whose total exceeds the threshold.
 * Below the threshold a fast prepare isn't worth a footer, so this returns `undefined` and the
 * caller renders nothing.
 */
export function selectFooterPrepareTimeline(parts: readonly CherryMessagePart[]): PrepareTimeline | undefined {
  for (const part of parts) {
    if ((part.type as string) !== 'data-prepare-progress' || !('data' in part) || !part.data) continue
    const { timeline } = part.data as PrepareProgressPartData
    if (timeline && timeline.totalMs > PREPARE_TIMELINE_FOOTER_THRESHOLD_MS) return timeline
  }
  return undefined
}

function formatSeconds(ms: number): number {
  return Math.round(ms / 100) / 10
}

interface PrepareTimelineFooterProps {
  timeline: PrepareTimeline
}

/**
 * Post-hoc "response preparation took Ns" line for a slow first token. Collapsed by default; expands
 * to a per-stage table and a "copy diagnostics" button. Diagnostics carry only non-sensitive fields
 * (stage breakdown, app version, agent type, MCP server names) — never env vars, keys, or base URLs.
 */
const PrepareTimelineFooter: React.FC<PrepareTimelineFooterProps> = ({ timeline }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      const info = await ipcApi.request('app.get_info')
      const diagnostics = buildPrepareDiagnostics({ timeline, appVersion: info?.version ?? 'unknown' })
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      toast.success(t('message.copied'))
    } catch {
      toast.error(t('common.copy_failed'))
    }
  }, [timeline, t])

  return (
    <div className="flex flex-col gap-1 text-foreground-muted text-xs">
      <button
        type="button"
        className="flex w-fit select-none items-center gap-1 hover:text-foreground"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>
          {t('message.tools.placeholder.prepare.footer.summary', { seconds: formatSeconds(timeline.totalMs) })}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background-soft p-2">
          <table className="w-full border-collapse text-left">
            <tbody>
              {timeline.stages.map((entry, index) => (
                <tr key={`${entry.stage}-${index}`} className="align-top">
                  <td className="py-0.5 pr-3 font-mono">{entry.stage}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{entry.ms} ms</td>
                  <td className="py-0.5 font-mono text-[11px] text-foreground-muted">
                    {entry.detail ? JSON.stringify(entry.detail) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="ghost" size="sm" className="w-fit gap-1" onClick={handleCopy}>
            <Copy size={12} />
            {t('message.tools.placeholder.prepare.footer.copy')}
          </Button>
        </div>
      )}
    </div>
  )
}

export default React.memo(PrepareTimelineFooter)

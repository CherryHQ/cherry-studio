import { PREPARE_PROGRESS_LABEL_MIN_ELAPSED_MS, type PreparePhase } from '@shared/ai/agentPrepareTimeline'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

interface PlaceholderBlockProps {
  isProcessing: boolean
  createdAt: string
  status?: PlaceholderStatus
  /** Coarse prepare phase from the streamed `data-prepare-progress` part (only while `preparing`). */
  preparePhase?: PreparePhase
  /** MCP server name to surface in the "connecting MCP servers" label when one dominates. */
  prepareMcpServerName?: string
}

export type PlaceholderStatus = 'generating' | 'preparing' | 'thinking' | 'usingTools'

const PLACEHOLDER_LABEL_KEYS: Record<PlaceholderStatus, string> = {
  generating: 'message.tools.placeholder.generating',
  preparing: 'message.tools.placeholder.preparing',
  thinking: 'message.tools.placeholder.thinking',
  usingTools: 'message.tools.placeholder.usingTools'
}

const PREPARE_PHASE_LABEL_KEYS: Record<PreparePhase, string> = {
  'starting-runtime': 'message.tools.placeholder.prepare.startingRuntime',
  'connecting-mcp': 'message.tools.placeholder.prepare.connectingMcp',
  'waiting-first-response': 'message.tools.placeholder.prepare.waitingFirstResponse'
}

type Translate = (key: string, options?: Record<string, number | string>) => string

function getElapsedMs(createdAt: string): number {
  const createdAtMs = Date.parse(createdAt)
  if (!Number.isFinite(createdAtMs)) return 0
  return Math.max(0, Date.now() - createdAtMs)
}

export function usePlaceholderElapsedMs(isProcessing: boolean, createdAt: string, updateIntervalMs = 100): number {
  const [elapsedMs, setElapsedMs] = React.useState(() => (isProcessing ? getElapsedMs(createdAt) : 0))

  React.useEffect(() => {
    if (!isProcessing) return

    const updateElapsed = () => setElapsedMs(getElapsedMs(createdAt))
    updateElapsed()

    const timer = setInterval(updateElapsed, updateIntervalMs)
    return () => clearInterval(timer)
  }, [createdAt, isProcessing, updateIntervalMs])

  return elapsedMs
}

export function formatPlaceholderElapsed(elapsedMs: number, t: Translate): string {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs))
  const totalSeconds = Math.round(safeElapsedMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60)

  if (days > 0) return t('message.tools.placeholder.elapsed.days', { days, hours, minutes, seconds })
  if (hours > 0) return t('message.tools.placeholder.elapsed.hours', { hours, minutes, seconds })
  if (minutes > 0) return t('message.tools.placeholder.elapsed.minutes', { minutes, seconds })
  return t('message.tools.placeholder.elapsed.seconds', { seconds })
}

/**
 * Pick the placeholder text. For the first {@link PREPARE_PROGRESS_LABEL_MIN_ELAPSED_MS} of a
 * `preparing` turn (or when no prepare phase is known) the generic "Preparing response" shows; past
 * that threshold the coarse prepare phase takes over so a slow first token isn't a silent wait. The
 * phase override applies only to `preparing` — once the model streams, the derived status wins.
 */
export function selectPlaceholderLabel(input: {
  status: PlaceholderStatus
  elapsedMs: number
  preparePhase?: PreparePhase
  prepareMcpServerName?: string
  t: Translate
}): string {
  const { status, elapsedMs, preparePhase, prepareMcpServerName, t } = input
  if (status === 'preparing' && preparePhase && elapsedMs >= PREPARE_PROGRESS_LABEL_MIN_ELAPSED_MS) {
    if (preparePhase === 'connecting-mcp' && prepareMcpServerName) {
      return t('message.tools.placeholder.prepare.connectingMcpNamed', { name: prepareMcpServerName })
    }
    return t(PREPARE_PHASE_LABEL_KEYS[preparePhase])
  }
  return t(PLACEHOLDER_LABEL_KEYS[status])
}

const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({
  isProcessing,
  createdAt,
  status = 'preparing',
  preparePhase,
  prepareMcpServerName
}) => {
  const { t } = useTranslation()
  const elapsedMs = usePlaceholderElapsedMs(isProcessing, createdAt)

  if (isProcessing) {
    const label = selectPlaceholderLabel({ status, elapsedMs, preparePhase, prepareMcpServerName, t })
    return (
      <div
        className="flex min-h-7 select-none flex-row items-center gap-1.5 py-0.5 text-[13px] text-foreground-muted leading-5"
        data-testid="message-status-placeholder">
        <span data-testid="message-status-text">{label}</span>
        <BeatLoader color="var(--color-foreground-muted)" size={4} speedMultiplier={0.8} />
      </div>
    )
  }
  return null
}
export default React.memo(PlaceholderBlock)

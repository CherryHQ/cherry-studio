import { Pause, Play, Square } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { speechPlaybackService, voiceService } from '@renderer/services/voice'
import type { VoiceSessionPhase } from '@shared/ipc/schemas/voice'

export interface VoicePlaybackBarProps {
  readonly phase: Exclude<VoiceSessionPhase, 'idle'>
  readonly source: 'playback'
  readonly failed: boolean
  readonly onPause: () => void
  readonly onResume: () => void
  readonly onStop: () => void
}

const INITIALIZATION_RETRY_DELAYS_MS = [250, 1_000] as const

interface FailureVersion {
  readonly sessionId: string | undefined
  readonly revision: number
}

interface ControlFailure extends FailureVersion {
  readonly generation: number
}

export function VoicePlaybackBar({ phase, failed, onPause, onResume, onStop }: VoicePlaybackBarProps) {
  const { t } = useTranslation()
  const canPause = phase === 'playing' || phase === 'ready'
  const canResume = phase === 'paused'

  return (
    <div
      role="status"
      aria-label={t('settings.voice.playback.title')}
      className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{t('settings.voice.playback.source')}</div>
        <div className="truncate text-xs text-muted-foreground">
          {t(failed ? 'settings.voice.status.operation_failed' : `settings.voice.playback.state.${phase}`)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canResume ? (
          <Button variant="ghost" size="icon-sm" aria-label={t('settings.voice.action.resume')} onClick={onResume}>
            <Play className="size-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.pause')}
            disabled={!canPause}
            onClick={onPause}>
            <Pause className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={t('common.stop')} onClick={onStop}>
          <Square className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export function VoicePlaybackHost(): React.ReactElement | null {
  const state = useSyncExternalStore(voiceService.subscribe, voiceService.getSnapshot, voiceService.getSnapshot)
  const sessionId = state.phase === 'idle' || state.source !== 'playback' ? undefined : state.sessionId
  const currentStateRef = useRef<FailureVersion>({ sessionId, revision: state.revision })
  const controlGenerationRef = useRef(0)
  const [initializationFailure, setInitializationFailure] = useState<FailureVersion>()
  const [controlFailure, setControlFailure] = useState<ControlFailure>()

  currentStateRef.current = { sessionId, revision: state.revision }

  useEffect(() => {
    let current = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const trigger = currentStateRef.current

    const initialize = (attempt: number) => {
      void voiceService
        .initialize()
        .then(() => {
          if (current) setInitializationFailure(undefined)
        })
        .catch(() => {
          if (!current) return
          const delay = INITIALIZATION_RETRY_DELAYS_MS[attempt]
          if (delay === undefined) {
            if (
              currentStateRef.current.sessionId === trigger.sessionId &&
              currentStateRef.current.revision === trigger.revision
            ) {
              setInitializationFailure(trigger)
            }
            return
          }
          retryTimer = setTimeout(() => initialize(attempt + 1), delay)
        })
    }

    initialize(0)
    return () => {
      current = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [])

  if (!sessionId || state.phase === 'idle' || state.source !== 'playback') return null

  const control = (operationSessionId: string, operationRevision: number, operation: () => Promise<void>) => {
    const generation = ++controlGenerationRef.current
    setControlFailure(undefined)
    void operation().catch(() => {
      if (
        currentStateRef.current.sessionId === operationSessionId &&
        currentStateRef.current.revision === operationRevision &&
        controlGenerationRef.current === generation
      ) {
        setControlFailure({ sessionId: operationSessionId, revision: operationRevision, generation })
      }
    })
  }

  const initializationFailed =
    initializationFailure?.sessionId === sessionId && initializationFailure.revision === state.revision
  const controlFailed = controlFailure?.sessionId === sessionId && controlFailure.revision === state.revision

  return (
    <VoicePlaybackBar
      phase={state.phase}
      source="playback"
      failed={initializationFailed || controlFailed || state.phase === 'failed'}
      onPause={() => control(sessionId, state.revision, () => speechPlaybackService.pause(sessionId))}
      onResume={() => control(sessionId, state.revision, () => speechPlaybackService.resume(sessionId))}
      onStop={() => control(sessionId, state.revision, () => speechPlaybackService.stop(sessionId))}
    />
  )
}

import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  createComposerUserMessageParts,
  trimComposerDraftBoundaryBlankLines
} from '@renderer/components/composer/composerDraft'
import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { formatErrorMessage } from '@renderer/utils/error'
import { expandSelectionPrompt, parseSelectionActions } from '@renderer/utils/selectionAction'
import { cn } from '@renderer/utils/style'
import { type AgentSelectionAction, isAgentSelectionAction, type SelectionActionSession } from '@shared/types/selection'

import { SelectionAgentComposeBar } from './components/SelectionAgentComposeBar'
import { SelectionAgentConversation, type SelectionAgentFirstMessage } from './components/SelectionAgentConversation'
import { SelectionAgentHeader } from './components/SelectionAgentHeader'
import {
  createSelectionAgentSession,
  getSelectionAgentTarget,
  isSelectionWorkspaceUnavailableError,
  type SelectionAgentTarget
} from './selectionAgentSession'

const logger = loggerService.withContext('SelectionAgentWindow')

/** The shell's 2px margin on each side, which the reported compose height must include. */
const SHELL_MARGIN = 4

type Stage =
  | { kind: 'compose'; sending: boolean; error: string | null }
  | { kind: 'starting' }
  | { kind: 'failed'; message: string }
  | { kind: 'conversation'; sessionId: string; firstMessage: SelectionAgentFirstMessage }

/** Pulls each open's payload; a fresh `sessionId` remounts the content so no state leaks between opens. */
const SelectionAgentWindow: FC = () => {
  const action = useWindowInitData<SelectionActionSession>()
  if (!action || !isAgentSelectionAction(action)) return null
  // Composer surfaces need a quick panel context, which ConversationShell provides in other windows.
  return (
    <QuickPanelProvider key={action.sessionId}>
      <SelectionAgentContent action={action} />
    </QuickPanelProvider>
  )
}

const SelectionAgentContent: FC<{ action: AgentSelectionAction }> = ({ action }) => {
  const { t } = useTranslation()
  const [isAutoPin] = usePreference('feature.selection.auto_pin')
  const [initialOpacity] = usePreference('feature.selection.action_window_opacity')
  const [actionItems] = usePreference('feature.selection.action_items')
  const [isPinned, setIsPinned] = useState(isAutoPin)
  const [opacity, setOpacity] = useState(initialOpacity)
  const [stage, setStage] = useState<Stage>(() =>
    action.isBuiltIn ? { kind: 'compose', sending: false, error: null } : { kind: 'starting' }
  )
  const shellRef = useRef<HTMLDivElement>(null)
  const selectedText = action.selectedText ?? ''
  const actionName = action.isBuiltIn ? t(action.name) : action.name
  // The binding is changed in the selection settings while this window stays open, so follow it there.
  const target = useMemo(() => {
    const current = parseSelectionActions(actionItems ?? []).find((item) => item.id === action.id)
    return getSelectionAgentTarget(current && isAgentSelectionAction(current) ? current : action)
  }, [action, actionItems])
  const { agent: boundAgent } = useAgent(action.isBuiltIn ? null : target.agentId)
  const agentName = boundAgent?.name ?? actionName

  useEffect(() => {
    void ipcApi.request('selection.pin_action_window', isAutoPin)
    // Pinning follows the preference once per open; the header toggle owns it afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.title = `${actionName} - ${t('selection.name')}`
  }, [actionName, t])

  /** Resolves to a user-facing message when the session could not be created. */
  const start = useCallback(
    async (target: SelectionAgentTarget, firstMessage: SelectionAgentFirstMessage): Promise<string | null> => {
      try {
        const sessionId = await createSelectionAgentSession(target)
        setStage({ kind: 'conversation', sessionId, firstMessage })
        void ipcApi.request('selection.resize_agent_window', { mode: 'conversation' })
        return null
      } catch (error) {
        logger.error('Failed to create the selection agent session', error as Error)
        return isSelectionWorkspaceUnavailableError(error)
          ? t('selection.agent.workspace_unavailable_hint')
          : formatErrorMessage(error)
      }
    },
    [t]
  )

  // An agent-bound custom action has no compose bar: it sends its expanded prompt right away.
  const startCustomAction = () => {
    if (action.isBuiltIn) return
    setStage({ kind: 'starting' })
    const source = action.programName ? t('selection.agent.source', { app: action.programName }) : ''
    const text = [expandSelectionPrompt(action.prompt, selectedText), source].filter(Boolean).join('\n\n')
    void start(target, { text }).then((message) => message && setStage({ kind: 'failed', message }))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(startCustomAction, [])

  const handleComposeSend = useCallback(
    async (draft: ComposerSerializedDraft) => {
      const normalized = trimComposerDraftBoundaryBlankLines(draft)
      if (!normalized.text.trim()) return
      setStage({ kind: 'compose', sending: true, error: null })
      const message = await start(target, {
        text: normalized.text,
        userMessageParts: createComposerUserMessageParts(normalized)
      })
      if (message) setStage({ kind: 'compose', sending: false, error: message })
    },
    [start, target]
  )

  const isCompose = stage.kind === 'compose'
  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!isCompose || !shell) return
    // The window fits the compose bar; observing reports the current size too, which fits the first frame.
    const observer = new ResizeObserver(() => {
      void ipcApi.request('selection.resize_agent_window', {
        mode: 'compose',
        height: shell.offsetHeight + SHELL_MARGIN
      })
    })
    observer.observe(shell)
    return () => observer.disconnect()
  }, [isCompose])

  const togglePin = () => {
    setIsPinned(!isPinned)
    void ipcApi.request('selection.pin_action_window', !isPinned)
  }

  return (
    <div
      ref={shellRef}
      data-ui="selection.agent"
      className={cn(
        'm-0.5 flex w-[calc(100%-4px)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-[0_0_2px_var(--border)]',
        // #root is a stretching flex row; the compose shell must keep its content height so main can fit the window to it.
        isCompose ? 'self-start' : 'h-[calc(100%-4px)]'
      )}
      style={{ opacity: opacity / 100 }}>
      {stage.kind === 'compose' && (
        <SelectionAgentComposeBar
          selectedText={selectedText}
          programName={action.programName}
          target={target}
          sending={stage.sending}
          error={stage.error}
          onSend={(draft) => void handleComposeSend(draft)}
        />
      )}
      {stage.kind === 'conversation' && (
        <SelectionAgentConversation
          sessionId={stage.sessionId}
          firstMessage={stage.firstMessage}
          isPinned={isPinned}
          onTogglePin={togglePin}
          opacity={opacity}
          onOpacityChange={setOpacity}
        />
      )}
      {(stage.kind === 'starting' || stage.kind === 'failed') && (
        <div className="flex h-full flex-col">
          <SelectionAgentHeader
            avatar={boundAgent ? getAgentAvatarFromConfiguration(boundAgent.configuration) : undefined}
            title={boundAgent?.name ?? actionName}
            subtitle={boundAgent ? actionName : undefined}
            isPinned={isPinned}
            onTogglePin={togglePin}
            opacity={opacity}
            onOpacityChange={setOpacity}
          />
          <div className="px-4 pt-1 pb-3 text-sm">
            {stage.kind === 'starting' ? (
              <div role="status" className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                {t('selection.agent.starting', { name: agentName })}
              </div>
            ) : (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-lg border border-error-border bg-error-subtle px-3 py-2.5 text-error-subtle-foreground">
                <div className="flex items-center gap-1.5 font-medium">
                  <CircleAlert className="size-3.5 shrink-0" />
                  {t('selection.agent.start_failed', { name: agentName })}
                </div>
                <div>{stage.message}</div>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-error-border bg-background shadow-none"
                    onClick={startCustomAction}>
                    <RefreshCw className="size-3.5" />
                    {t('common.retry')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SelectionAgentWindow

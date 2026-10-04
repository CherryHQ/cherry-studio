import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentSessionTaskEvents } from '@renderer/hooks/agent/useAgentSessionTaskEvents'
import { toast } from '@renderer/services/toast'

import { isResumeReceiptCall, resolveFlowToolCallId, type AgentToolFlowOpenInput } from './agentRightPaneProjection'
import { useAgentRightPaneRuntime } from './agentRightPaneRuntime'

interface PendingFlowOpen {
  sessionId?: string
  input: AgentToolFlowOpenInput
  nested: boolean
}

/**
 * The deferred-flow state machine: a root outside the loaded window is not a dead click — the
 * intent is held and older history paged in until it arrives, and it dies with the session that
 * asked for it. Kept out of the pane's action provider so its own concerns stay readable.
 */
export function useAgentToolFlowActions({
  sessionId,
  canOpenAgentToolFlow,
  replaceFlowTab,
  requestOpenFlowTab
}: {
  sessionId?: string
  canOpenAgentToolFlow: boolean
  replaceFlowTab: (input: AgentToolFlowOpenInput, nested: boolean) => void
  requestOpenFlowTab: (toolCallId: string) => void
}): { openAgentToolFlow: (input: AgentToolFlowOpenInput, nested?: boolean) => void } {
  const { t } = useTranslation()
  const runtime = useAgentRightPaneRuntime()
  // Read the parts map at call time through a ref so message streaming does not re-create the
  // actions object (and re-render consumers that only open flows).
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  // Task edges can arrive through the runtime's live cache without ever being a loaded part, and a
  // dsh resume edge is what decides whether a receipt roots its own flow. Read through a ref so the
  // actions object stays stable — re-creating it re-renders every tool row on each task-event write.
  const lateTaskEvents = useAgentSessionTaskEvents(sessionId)
  const lateTaskEventsRef = useRef(lateTaskEvents)
  lateTaskEventsRef.current = lateTaskEvents
  const [pendingFlowOpen, setPendingFlowOpen] = useState<PendingFlowOpen | null>(null)
  const pagedForRef = useRef<string | null>(null)
  // The paging failure already seen when the current page was requested: only a new one is the
  // failure of this request, since a stale error survives until a fetch succeeds.
  const pagedErrorRef = useRef<unknown>(null)
  const showFlowTab = useCallback(
    (input: AgentToolFlowOpenInput, nested: boolean) => {
      // Any flow opening supersedes a chase that is still paging — the user has moved on to it.
      setPendingFlowOpen(null)
      pagedForRef.current = null
      replaceFlowTab(input, nested)
      requestOpenFlowTab(input.toolCallId)
    },
    [replaceFlowTab, requestOpenFlowTab]
  )
  const openAgentToolFlow = useCallback(
    (input: AgentToolFlowOpenInput, nested = false) => {
      if (!canOpenAgentToolFlow) return
      // A task bound to its send-message receipt (cold reconnect replay) must still open the flow
      // its agent actually streams under — the launch root.
      const partsByMessageId = runtimeRef.current?.partsByMessageId ?? null
      const lateEvents = lateTaskEventsRef.current
      const resolved = resolveFlowToolCallId(input.toolCallId, partsByMessageId, lateEvents)
      // A receipt whose root is merely paged out is worth waiting for; one that resolves nowhere
      // must not open an empty pane rooted at the continuation itself.
      if (!resolved && isResumeReceiptCall(input.toolCallId, partsByMessageId, lateEvents)) {
        pagedForRef.current = null
        setPendingFlowOpen({ sessionId, input, nested })
        return
      }
      const flowInput = resolved
        ? { ...input, toolCallId: resolved.toolCallId, title: resolved.description ?? input.title }
        : input
      showFlowTab(flowInput, nested)
    },
    [canOpenAgentToolFlow, sessionId, showFlowTab]
  )
  // A chase belongs to the session that asked for it: leaving that session abandons the click
  // rather than reopening the flow when the user later wanders back.
  useEffect(() => {
    if (pendingFlowOpen && pendingFlowOpen.sessionId !== sessionId) setPendingFlowOpen(null)
  }, [pendingFlowOpen, sessionId])
  useEffect(() => {
    if (!pendingFlowOpen || pendingFlowOpen.sessionId !== sessionId) return
    const { input, nested } = pendingFlowOpen
    const partsByMessageId = runtime.partsByMessageId
    const resolved = resolveFlowToolCallId(input.toolCallId, partsByMessageId, lateTaskEvents)
    if (resolved) {
      setPendingFlowOpen(null)
      pagedForRef.current = null
      showFlowTab({ ...input, toolCallId: resolved.toolCallId, title: resolved.description ?? input.title }, nested)
      return
    }
    // The receipt can stop being one while the chase waits: a runtime edge that binds its call as a
    // flow root (a cold-resumed dsh child) means the click now has a flow of its own, and paging for
    // a launch root that will never exist would end in a dead click.
    if (!isResumeReceiptCall(input.toolCallId, partsByMessageId, lateTaskEvents)) {
      setPendingFlowOpen(null)
      pagedForRef.current = null
      showFlowTab(input, nested)
      return
    }
    if (!runtime.hasOlder) {
      // No history is left to page: the root is absent, so say so instead of ignoring the click.
      setPendingFlowOpen(null)
      pagedForRef.current = null
      toast.warning(t('agent.right_pane.flow.no_messages.description'))
      return
    }
    // One page per arrival: the parts map changes with each load, so a repeat cannot spin.
    const requestKey = `${input.toolCallId}:${Object.keys(partsByMessageId ?? {}).length}`
    if (pagedForRef.current === requestKey) {
      // A page that failed leaves the window unchanged, so the chase would wait forever: report it
      // and drop the intent — the next click arms a fresh attempt.
      if (runtime.loadOlderError && runtime.loadOlderError !== pagedErrorRef.current) {
        setPendingFlowOpen(null)
        pagedForRef.current = null
        pagedErrorRef.current = null
        toast.warning(t('agent.right_pane.flow.history_load_failed'))
      }
      return
    }
    pagedForRef.current = requestKey
    pagedErrorRef.current = runtime.loadOlderError ?? null
    runtime.loadOlder?.()
  }, [lateTaskEvents, pendingFlowOpen, runtime, sessionId, showFlowTab, t])
  return { openAgentToolFlow }
}

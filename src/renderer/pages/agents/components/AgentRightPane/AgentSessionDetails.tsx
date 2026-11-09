import { ListCollapse } from 'lucide-react'
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger, ScrollArea, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@renderer/data/hooks/useCache'

import {
  AGENT_DETAILS_INSET,
  AGENT_DETAILS_WIDTH,
  type AgentDetailsMode,
  resolveAgentDetailsMode
} from './agentSessionDetailsLayout'
import { AgentSessionDetailsContext, useAgentSessionDetails } from './useAgentSessionDetails'

export function AgentSessionDetailsProvider({
  sessionId,
  available,
  children
}: {
  sessionId?: string
  available: boolean
  children: ReactNode
}) {
  const [storedInlineOpen, setStoredInlineOpen] = usePersistCache('ui.agent.details.open')
  const [presentation, setPresentation] = useState<{
    sessionId?: string
    available: boolean
    mode: AgentDetailsMode
    popupOpen: boolean
  }>({
    sessionId,
    available,
    mode: 'popover',
    popupOpen: false
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const suppressCloseFocusRef = useRef(false)
  if (presentation.sessionId !== sessionId || presentation.available !== available) {
    setPresentation({ ...presentation, sessionId, available, popupOpen: false })
  }
  const inlineOpen = !!sessionId && storedInlineOpen
  const setInlineOpen = useCallback(
    (open: boolean) => {
      if (!sessionId) return
      setStoredInlineOpen(open)
    },
    [sessionId, setStoredInlineOpen]
  )
  const measure = useCallback((width: number, height: number) => {
    setPresentation((previous) => {
      const mode = resolveAgentDetailsMode(width, height, previous.mode)
      return mode === previous.mode ? previous : { ...previous, mode, popupOpen: false }
    })
  }, [])
  const dismissPopup = useCallback(() => {
    suppressCloseFocusRef.current = true
    setPresentation((previous) => (previous.popupOpen ? { ...previous, popupOpen: false } : previous))
  }, [])
  const setOpen = useCallback(
    (open: boolean) => {
      if (open) suppressCloseFocusRef.current = false
      if (presentation.mode === 'inline') setInlineOpen(open)
      else setPresentation((previous) => ({ ...previous, popupOpen: open }))
    },
    [presentation.mode, setInlineOpen]
  )
  const openDetails = useCallback(() => {
    triggerRef.current?.focus()
    suppressCloseFocusRef.current = false
    setInlineOpen(true)
    setPresentation((previous) => ({ ...previous, popupOpen: previous.mode === 'popover' }))
  }, [setInlineOpen])
  const state = useMemo(
    () => ({
      mode: presentation.mode,
      available,
      inlineOpen,
      popupOpen: available && presentation.popupOpen,
      triggerRef,
      suppressCloseFocusRef,
      measure,
      setOpen,
      openDetails,
      dismissPopup
    }),
    [presentation.mode, presentation.popupOpen, available, inlineOpen, measure, setOpen, openDetails, dismissPopup]
  )
  return (
    <AgentSessionDetailsContext value={state}>
      <Popover open={state.mode === 'popover' && state.popupOpen} onOpenChange={setOpen}>
        {children}
      </Popover>
    </AgentSessionDetailsContext>
  )
}

export function AgentSessionDetailsToggle({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const state = useAgentSessionDetails()
  if (!state.available) return null
  const label = t('agent.right_pane.tabs.details')
  const button = (
    <Button
      ref={state.triggerRef}
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      aria-expanded={state.mode === 'inline' ? state.inlineOpen : state.popupOpen}
      onClick={(event) => {
        if (state.mode !== 'inline') return
        event.preventDefault()
        state.setOpen(!state.inlineOpen)
      }}
      className="text-muted-foreground aria-expanded:bg-accent aria-expanded:text-foreground">
      <ListCollapse className="size-3.5" />
    </Button>
  )
  return (
    <>
      <Tooltip content={label} asChild>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </Tooltip>
      {state.mode === 'popover' && (
        <PopoverContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          className="w-70 max-w-[calc(100vw_-_24px)] overflow-hidden rounded-xl p-0"
          onCloseAutoFocus={(event) => {
            if (state.suppressCloseFocusRef.current || !state.available || !state.triggerRef.current?.isConnected)
              event.preventDefault()
          }}>
          <ScrollArea
            className="max-h-[min(70vh,var(--radix-popover-content-available-height))]"
            viewportProps={{ className: 'overflow-x-hidden' }}>
            {children}
          </ScrollArea>
        </PopoverContent>
      )}
    </>
  )
}

export function AgentSessionDetailsLayout({ children, details }: { children: ReactNode; details: ReactNode }) {
  const { t } = useTranslation()
  const state = useAgentSessionDetails()
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const { measure } = state
  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => {
      if (
        cardRef.current?.contains(document.activeElement) &&
        resolveAgentDetailsMode(element.clientWidth, element.clientHeight, 'inline') === 'popover'
      ) {
        state.triggerRef.current?.focus()
      }
      measure(element.clientWidth, element.clientHeight)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure, state.triggerRef])
  const visible = state.available && state.mode === 'inline' && state.inlineOpen
  return (
    <div ref={containerRef} data-agent-details-layout className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ marginRight: visible ? AGENT_DETAILS_INSET : 0 }}>
        {children}
      </div>
      {visible && (
        <aside
          ref={cardRef}
          aria-label={t('agent.right_pane.tabs.details')}
          data-agent-details-inline
          className="absolute top-3 right-3 grid max-h-[calc(100%_-_24px)] min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-xl border border-border-subtle bg-card"
          style={{ width: AGENT_DETAILS_WIDTH }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.stopPropagation()
            state.setOpen(false)
            state.triggerRef.current?.focus()
          }}>
          <ScrollArea className="min-h-0" viewportProps={{ className: 'overflow-x-hidden' }}>
            {details}
          </ScrollArea>
        </aside>
      )}
    </div>
  )
}

import { isToolUIPart } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { OutputFor } from '@shared/ipc/types'
import { hasMcpAppResult } from '@shared/types/mcpApp'

import { useOptionalMessageMountLease } from '../../list/MessageMountLeaseContext'
import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { MessageListActions } from '../../types'

const logger = loggerService.withContext('McpAppResultCards')

type View = OutputFor<'mcp.app.open'>
type ViewState =
  | { kind: 'opening' | 'error' }
  | { kind: 'review'; view: View }
  | { kind: 'mounted'; view: View; ready: boolean }

type ResultCardProps = {
  open: NonNullable<MessageListActions['openMcpApp']>
  messageId: string
  toolCallId: string
}

async function release(id: string) {
  try {
    await ipcApi.request('mcp.request.cancel', { requestId: id })
  } finally {
    await ipcApi.request('mcp.app.close', { id })
  }
}

function McpAppResultView({ open, messageId, toolCallId }: ResultCardProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<ViewState>({ kind: 'opening' })
  const [height, setHeight] = useState(180)
  const activeRequest = useRef<string | undefined>(undefined)
  const acquireMountLease = useOptionalMessageMountLease()?.acquireMessageMountLease
  const hasGuest = state.kind === 'mounted'

  useEffect(() => (hasGuest ? acquireMountLease?.(messageId) : undefined), [acquireMountLease, hasGuest, messageId])

  const close = useCallback(() => {
    const id = activeRequest.current
    activeRequest.current = undefined
    if (id) void release(id).catch((error) => logger.debug('Unable to release MCP App', { error }))
  }, [])

  useIpcOn('mcp.app.state_changed', ({ id, state: next, height }) => {
    if (activeRequest.current !== id) return
    if (next === 'size' && height !== undefined) setHeight(height)
    if (next === 'ready') {
      setState((state) => (state.kind === 'mounted' ? { ...state, ready: true } : state))
    }
    if (next === 'closed' || next === 'error') {
      activeRequest.current = undefined
      setState({ kind: 'error' })
    }
  })

  const launch = useCallback(async () => {
    const id = crypto.randomUUID()
    activeRequest.current = id
    setHeight(180)
    setState({ kind: 'opening' })
    try {
      const view = await open(messageId, toolCallId, id)
      if (activeRequest.current !== id) {
        await release(id)
        return
      }
      setState(view.origins.length ? { kind: 'review', view } : { kind: 'mounted', view, ready: false })
    } catch (error) {
      if (activeRequest.current === id) {
        activeRequest.current = undefined
        setState({ kind: 'error' })
        logger.warn('Unable to open MCP App', { error })
      }
    }
  }, [open, messageId, toolCallId])

  useEffect(() => {
    void launch()
    return close
  }, [close, launch])

  return (
    <>
      {state.kind === 'error' && (
        <>
          <p role="alert" className="mb-2 text-sm text-muted-foreground">
            {t('message.tools.mcp_app.failed')}
          </p>
          <Button size="sm" variant="outline" onClick={() => void launch()}>
            {t('common.retry')}
          </Button>
        </>
      )}
      {state.kind === 'review' && (
        <>
          <p className="mb-2 break-all text-sm text-muted-foreground">
            {t('message.tools.mcp_app.origins', { origins: state.view.origins.join(', ') })}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setState({ kind: 'mounted', view: state.view, ready: false })}>
            {t('common.confirm')}
          </Button>
        </>
      )}
      {(state.kind === 'opening' || (state.kind === 'mounted' && !state.ready)) && (
        <p role="status" className="mb-2 text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {state.kind === 'mounted' && (
        <webview
          key={state.view.id}
          src={state.view.src}
          partition={state.view.partition}
          aria-label={t('message.tools.mcp_app.open')}
          className="flex w-full overflow-hidden rounded-sm"
          style={{ height }}
        />
      )}
    </>
  )
}

function McpAppResultCard(props: ResultCardProps) {
  const slot = useRef<HTMLDivElement>(null)
  const [hasEnteredView, setHasEnteredView] = useState(false)

  useEffect(() => {
    const element = slot.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect()
        setHasEnteredView(true)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={slot} className="my-2 min-h-8 min-w-0">
      {hasEnteredView && <McpAppResultView {...props} />}
    </div>
  )
}

export function McpAppResultCards({ messageId, parts }: { messageId: string; parts: readonly CherryMessagePart[] }) {
  const open = useOptionalMessageListActions()?.openMcpApp
  if (!open) return null
  const renderedCalls = new Set<string>()
  return parts.flatMap((part) => {
    if (
      !isToolUIPart(part) ||
      part.state !== 'output-available' ||
      part.preliminary ||
      renderedCalls.has(part.toolCallId)
    ) {
      return []
    }
    if (!hasMcpAppResult(part.output)) return []
    renderedCalls.add(part.toolCallId)
    return [<McpAppResultCard key={part.toolCallId} open={open} messageId={messageId} toolCallId={part.toolCallId} />]
  })
}

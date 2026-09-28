import { MousePointerClick } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { CONVERSATION_ROUTES } from '@shared/utils/conversationRoute'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { SessionToolTarget } from './sessionToolResult'

const KIND_LABEL_KEYS = {
  create: 'message.tools.sessionCreate.created',
  read: 'message.tools.sessionRead.read',
  search: 'message.tools.sessionSearch.found',
  send: 'message.tools.sessionSend.sent'
} as const satisfies Record<SessionToolTarget['kind'], string>

export const SessionResultCards = React.memo(function SessionResultCards({
  targets
}: {
  targets: SessionToolTarget[]
}) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()

  if (targets.length === 0) return null

  return (
    <div className="mt-3 flex w-[calc(100%-2.5rem)] flex-col gap-2" data-testid="session-result-cards">
      {targets.map((target) => {
        const label = t(KIND_LABEL_KEYS[target.kind])
        const openLabel = t('message.tools.sessionCreate.open')
        const sessionName = target.sessionName || t('message.tools.sessionCreate.untitled')
        const targetLabel = [target.agentName, sessionName].filter(Boolean).join(' / ')
        const route = CONVERSATION_ROUTES[target.conversationType]

        return (
          <div
            key={target.renderKey}
            className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-subtle text-muted-foreground">
              <MousePointerClick aria-hidden="true" size={16} strokeWidth={1.8} />
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="shrink-0 text-muted-foreground text-sm">{label}</span>
              <Tooltip content={targetLabel} fullWidthTrigger classNames={{ placeholder: 'min-w-0 flex-1' }}>
                <span className="block truncate font-medium text-foreground text-sm">{targetLabel}</span>
              </Tooltip>
            </div>
            {actions?.navigateToRoute ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label={`${openLabel}: ${targetLabel}`}
                onClick={() =>
                  void actions.navigateToRoute?.({
                    path: route.path,
                    query: { [route.keyParam]: target.sessionId }
                  })
                }>
                {openLabel}
              </Button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
})

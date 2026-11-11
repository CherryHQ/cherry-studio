import {
  createContext,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  use,
  useEffect,
  useMemo,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { HoverCard, HoverCardContent, HoverCardTrigger, Tooltip } from '@cherrystudio/ui'
import { ConversationStatus } from '@renderer/components/chat/ConversationStatus'
import { requestConversationLocate } from '@renderer/hooks/useConversationLocateRequest'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getConversationStatus } from '@renderer/utils/conversationStatus'
import { getTabConversation } from '@renderer/utils/tabConversation'
import { classifyTurn } from '@shared/ai/transport'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

const PreviewMessages = lazy(() => import('./ConversationTabPreviewContent'))

const PreviewContext = createContext<{ openId: string | null; setOpenId: (id: string | null) => void } | null>(null)

export function ConversationTabPreviewProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const value = useMemo(() => ({ openId, setOpenId }), [openId])
  return <PreviewContext value={value}>{children}</PreviewContext>
}

function topicIdFor(target: ConversationNavigationTarget) {
  return target.conversationType === 'agent' ? buildAgentSessionTopicId(target.conversationId) : target.conversationId
}

function Status({ target, isActive }: { target: ConversationNavigationTarget; isActive: boolean }) {
  const stream = useTopicStreamStatus(topicIdFor(target))
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      <ConversationStatus
        status={getConversationStatus({
          ...stream,
          isAwaitingApproval:
            stream.awaitingApprovalAnchors.length > 0 || classifyTurn(stream.status).isAwaitingApproval,
          isErrored: stream.status === 'error',
          isActive
        })}
      />
    </span>
  )
}

export function ConversationTabStatus({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const target = getTabConversation(tab)
  return target ? <Status target={target} isActive={isActive} /> : null
}

type Props = { tab: Tab; isActive: boolean; disabled: boolean; onSelect: () => void; children: ReactElement }

export function ConversationTabPreview(props: Props) {
  const target = getTabConversation(props.tab)
  if (!target)
    return props.tab.isPinned ? (
      <Tooltip placement="bottom" content={props.tab.title} delay={600}>
        {props.children}
      </Tooltip>
    ) : (
      props.children
    )
  return <ConversationPreview key={`${props.tab.id}:${props.tab.url}`} {...props} target={target} />
}

function ConversationPreview({
  tab,
  target,
  isActive,
  disabled,
  onSelect,
  children
}: Props & { target: ConversationNavigationTarget }) {
  const { t } = useTranslation()
  const context = use(PreviewContext)
  const identity = `${tab.id}:${tab.url}`
  const open = context?.openId === identity && !isActive && !disabled
  const close = () => {
    if (context?.openId === identity) context.setOpenId(null)
  }
  useEffect(() => {
    if ((isActive || disabled) && context?.openId === identity) context.setOpenId(null)
  }, [context, disabled, isActive, identity])
  return (
    <HoverCard
      open={open}
      onOpenChange={(value) => {
        if (value && !isActive && !disabled) context?.setOpenId(identity)
        else close()
      }}
      openDelay={500}
      closeDelay={180}>
      <HoverCardTrigger
        asChild
        onPointerDown={close}
        onContextMenu={close}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
        }}>
        {children}
      </HoverCardTrigger>
      {open && (
        <HoverCardContent
          side="bottom"
          align="start"
          collisionPadding={12}
          className="flex max-h-[min(360px,var(--radix-hover-card-content-available-height))] w-100 max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0 motion-reduce:animate-none"
          onEscapeKeyDown={close}>
          <Suspense fallback={<div className="p-4 text-muted-foreground text-xs">{t('common.loading')}</div>}>
            <PreviewMessages
              tab={tab}
              target={target}
              onOpen={(messageId) => {
                if (messageId) requestConversationLocate(tab.id, target.conversationId, messageId)
                close()
                onSelect()
              }}
            />
          </Suspense>
        </HoverCardContent>
      )}
    </HoverCard>
  )
}

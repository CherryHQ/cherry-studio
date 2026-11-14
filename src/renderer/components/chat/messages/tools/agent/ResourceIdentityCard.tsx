import { Check } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmojiAvatar } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { resolveChatEntryTopicIdForAssistant } from '@renderer/utils/conversationEntry'
import { DEFAULT_AGENT_CREATE_AVATAR } from '@shared/ai/agentCreateCommand'
import { DEFAULT_ASSISTANT_CREATE_AVATAR } from '@shared/ai/assistantCreateDto'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ResourceIdentityResult } from './resourceIdentityResult'

const logger = loggerService.withContext('ResourceIdentityCard')

async function conversationRoute(
  result: ResourceIdentityResult
): Promise<{ path: string; query: Record<string, string> }> {
  if (result.kind === 'agent') return { path: '/app/agents', query: { agentId: result.id } }
  // The chat page shows nothing for an Assistant without topics, so open its latest topic or an empty one.
  const topicId =
    (await resolveChatEntryTopicIdForAssistant(result.id)) ??
    (await dataApiService.post('/topics/reusable-placeholder', { body: { assistantId: result.id } })).topic.id
  return { path: '/app/chat', query: { topicId } }
}

/** The Agent or Assistant a create / configure tool just made or changed, with a way into it. */
export function ResourceIdentityCard({ result }: { result: ResourceIdentityResult }) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const navigateToRoute = actions?.navigateToRoute
  const openConversation =
    navigateToRoute && !result.self
      ? () =>
          void conversationRoute(result)
            .then(navigateToRoute)
            .catch((error) => logger.error('Failed to open the conversation', error as Error))
      : undefined
  const fallbackEmoji = result.kind === 'agent' ? DEFAULT_AGENT_CREATE_AVATAR : DEFAULT_ASSISTANT_CREATE_AVATAR
  const openLabel = t('message.tools.identity_card.open_conversation')
  const adjustLabel = t('library.config.dialogs.create.result.adjust')

  const handleButton = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    action()
  }

  return (
    // The card is a mouse shortcut for the Open conversation button, which stays the keyboard path.
    <div
      data-testid="resource-identity-card"
      className="my-1 w-full max-w-md rounded-xl border border-border bg-background px-3.5 py-3 data-[clickable=true]:cursor-pointer data-[clickable=true]:hover:bg-muted/40"
      data-clickable={openConversation ? 'true' : undefined}
      onClick={openConversation}>
      <div className="flex items-center gap-3">
        <EmojiAvatar
          size={40}
          fontSize={20}
          className="shrink-0 cursor-default rounded-[28%] border border-border hover:opacity-100">
          {result.emoji || fallbackEmoji}
        </EmojiAvatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-success-subtle-foreground text-xs">
            <Check aria-hidden="true" size={13} strokeWidth={2} />
            <span>
              {result.action === 'created'
                ? t('message.tools.identity_card.created')
                : t('message.tools.identity_card.updated')}
            </span>
          </div>
          <div className="truncate font-medium text-foreground text-sm" title={result.name}>
            {result.name}
          </div>
          {result.description ? (
            <div className="truncate text-muted-foreground text-xs" title={result.description}>
              {result.description}
            </div>
          ) : null}
        </div>
      </div>
      {result.summary.length > 0 ? (
        <ul className="mt-2.5 space-y-0.5 border-border-subtle border-t pt-2">
          {result.summary.map((line) => (
            <li key={line} className="truncate text-[12px] text-muted-foreground leading-5" title={line}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2.5 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${adjustLabel}: ${result.name}`}
          onClick={handleButton(() => openResourceEditDialog({ kind: result.kind, id: result.id }))}>
          {adjustLabel}
        </Button>
        {openConversation ? (
          <Button
            type="button"
            variant="emphasis"
            size="sm"
            aria-label={`${openLabel}: ${result.name}`}
            onClick={handleButton(openConversation)}>
            {openLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

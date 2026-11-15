import { ArrowRight, Check } from 'lucide-react'
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
  const startLabel = t('library.config.dialogs.create.result.start')
  const adjustLabel = t('library.config.dialogs.create.result.adjust')
  const created = result.action === 'created'
  // Results saved before the tools reported highlights only carry the summary lines.
  const chips = created ? (result.highlights ?? result.summary).slice(0, 3) : []

  const handleButton = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    action()
  }

  const meta = [result.description, ...chips].filter(Boolean).join(' · ')
  // A drag that selects text ends in a click too; copying the description must not leave the conversation.
  const handleCardClick = openConversation
    ? () => {
        if (window.getSelection()?.isCollapsed === false) return
        openConversation()
      }
    : undefined

  return (
    // The card is a mouse shortcut for the Start conversation button, which stays the keyboard path.
    <div
      data-testid="resource-identity-card"
      className="my-1 w-fit max-w-md rounded-lg border border-border-subtle bg-card px-2.5 py-2 transition-colors data-[clickable=true]:cursor-pointer data-[clickable=true]:hover:bg-accent/40"
      data-clickable={openConversation ? 'true' : undefined}
      onClick={handleCardClick}>
      <div className="flex items-center gap-2.5">
        <EmojiAvatar
          size={32}
          fontSize={17}
          className="shrink-0 cursor-default rounded-lg border border-border-subtle bg-background hover:opacity-100">
          {result.emoji || fallbackEmoji}
        </EmojiAvatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-[13px] text-foreground leading-5" title={result.name}>
              {result.name}
            </span>
            <span className="shrink-0 text-[11px] text-foreground-tertiary leading-5">
              {result.kind === 'agent' ? t('library.type.agent') : t('library.type.assistant')}
            </span>
            {created ? null : (
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-success-subtle-foreground leading-5">
                <Check aria-hidden="true" size={11} strokeWidth={2} />
                {t('message.tools.identity_card.updated')}
              </span>
            )}
          </div>
          {meta ? (
            <div className="truncate text-muted-foreground text-xs leading-4" title={meta}>
              {meta}
            </div>
          ) : null}
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 min-h-6 px-1.5 text-muted-foreground"
            aria-label={`${adjustLabel}: ${result.name}`}
            onClick={handleButton(() => openResourceEditDialog({ kind: result.kind, id: result.id }))}>
            {adjustLabel}
          </Button>
          {openConversation ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 min-h-6 gap-0.5 rounded-md px-2 font-medium text-foreground"
              aria-label={`${startLabel}: ${result.name}`}
              onClick={handleButton(openConversation)}>
              {startLabel}
              <ArrowRight aria-hidden="true" className="size-2.5" />
            </Button>
          ) : null}
        </div>
      </div>
      {!created && result.summary.length > 0 ? (
        <ul className="mt-1.5 ml-10.5 space-y-0.5">
          {result.summary.map((line) => (
            <li key={line} className="truncate text-muted-foreground text-xs leading-4" title={line}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

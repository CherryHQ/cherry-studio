import { ArrowRight, Check, ChevronDown } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { resolveChatEntryTopicIdForAssistant } from '@renderer/utils/conversationEntry'
import { cn } from '@renderer/utils/style'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ResourceIdentityResult } from './resourceIdentityResult'
import { ResourceIdentityRow } from './ResourceIdentityRow'

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
  const [showChanges, setShowChanges] = useState(false)
  // The result only records the emoji; an uploaded avatar is read live, as its file is replaced on every change.
  const { data: agent } = useQuery('/agents/:agentId', {
    params: { agentId: result.id },
    enabled: result.kind === 'agent',
    swrOptions: { shouldRetryOnError: false }
  })
  const { data: assistant } = useQuery('/assistants/:id', {
    params: { id: result.id },
    enabled: result.kind === 'assistant',
    swrOptions: { shouldRetryOnError: false }
  })
  const avatarSrc = (result.kind === 'agent' ? agent : assistant)?.avatarSrc
  const actions = useOptionalMessageListActions()
  const navigateToRoute = actions?.navigateToRoute
  const openConversation =
    navigateToRoute && !result.self
      ? () =>
          void conversationRoute(result)
            .then(navigateToRoute)
            .catch((error) => logger.error('Failed to open the conversation', error as Error))
      : undefined
  const startLabel = t('library.config.dialogs.create.result.start')
  const adjustLabel = t('library.config.dialogs.create.result.adjust')
  const created = result.action === 'created'
  // Results saved before the tools reported highlights only carry the summary lines.
  const chips = created ? (result.highlights ?? result.summary).slice(0, 3) : []

  const handleButton = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    action()
  }

  const changeCount = created ? 0 : result.summary.length
  // An update reads as a change count, so the card keeps one size however many fields changed.
  const meta = changeCount
    ? t('message.tools.identity_card.changes', { count: changeCount })
    : [result.description, ...chips].filter(Boolean).join(' · ')
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
      className="my-1 w-full max-w-md rounded-lg border border-border-subtle bg-card px-2.5 py-2 transition-colors data-[clickable=true]:cursor-pointer data-[clickable=true]:hover:bg-accent/40"
      data-clickable={openConversation ? 'true' : undefined}
      onClick={handleCardClick}>
      <ResourceIdentityRow
        kind={result.kind}
        name={result.name}
        emoji={result.emoji}
        avatarSrc={avatarSrc}
        meta={
          changeCount ? (
            <button
              type="button"
              aria-expanded={showChanges}
              className="flex items-center gap-0.5 hover:text-foreground"
              onClick={handleButton(() => setShowChanges((shown) => !shown))}>
              {meta}
              <ChevronDown
                aria-hidden="true"
                className={cn('size-3 transition-transform', showChanges && 'rotate-180')}
              />
            </button>
          ) : (
            meta
          )
        }
        badge={
          created ? null : (
            <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-success-subtle-foreground leading-5">
              <Check aria-hidden="true" size={11} strokeWidth={2} />
              {t('message.tools.identity_card.updated')}
            </span>
          )
        }>
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
      </ResourceIdentityRow>
      {showChanges ? (
        <ul className="mt-2 space-y-1 rounded-md bg-muted/50 px-2.5 py-2">
          {result.summary.map((line) => (
            <li key={line} className="truncate text-foreground text-xs leading-4" title={line}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

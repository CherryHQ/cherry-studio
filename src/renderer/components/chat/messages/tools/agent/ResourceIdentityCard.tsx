import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { resolveChatEntryTopicIdForAssistant } from '@renderer/utils/conversationEntry'
import { cn } from '@renderer/utils/style'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import { ResultCard } from '../shared/ResultCard'
import type { ResourceIdentityResult } from './resourceIdentityResult'
import { ResourceAvatar } from './ResourceIdentityRow'

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

  const changeCount = created ? 0 : result.summary.length

  return (
    <ResultCard
      data-testid="resource-identity-card"
      media={<ResourceAvatar kind={result.kind} emoji={result.emoji} avatarSrc={avatarSrc} size={40} />}
      title={result.name}
      tag={result.kind === 'agent' ? t('library.type.agent') : t('library.type.assistant')}
      badge={
        created ? null : (
          <span className="flex shrink-0 items-center gap-0.5 font-normal text-[11px] text-success-subtle-foreground leading-5">
            <Check aria-hidden="true" size={11} strokeWidth={2} />
            {t('message.tools.identity_card.updated')}
          </span>
        )
      }
      // An update reads as a change count, so the card keeps one size however many fields changed.
      description={
        changeCount ? (
          <button
            type="button"
            aria-expanded={showChanges}
            className="inline-flex items-center gap-0.5 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              setShowChanges((shown) => !shown)
            }}>
            {t('message.tools.identity_card.changes', { count: changeCount })}
            <ChevronDown
              aria-hidden="true"
              className={cn('size-3 transition-transform', showChanges && 'rotate-180')}
            />
          </button>
        ) : (
          result.description || undefined
        )
      }
      meta={chips.join(' · ') || undefined}
      primary={openConversation ? { label: `${startLabel}: ${result.name}`, onClick: openConversation } : undefined}
      actions={
        <Tooltip content={adjustLabel}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${adjustLabel}: ${result.name}`}
            onClick={() => openResourceEditDialog({ kind: result.kind, id: result.id })}
            className="size-8 rounded-lg text-muted-foreground">
            <Settings2 className="size-4" />
          </Button>
        </Tooltip>
      }>
      {showChanges ? (
        <ul className="space-y-1 rounded-md bg-muted/50 px-2.5 py-2">
          {result.summary.map((line) => (
            <li key={line} className="truncate text-foreground text-xs leading-4" title={line}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </ResultCard>
  )
}

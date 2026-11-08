/**
 * `< i/N >` navigator rendered next to a user message that belongs to a
 * sibling group (i.e. an alternate-branch group created via the edit-and-
 * resend flow). Clicking the arrows flips the topic's `activeNodeId` to the
 * previous / next branch; the messages pane revalidates and re-renders.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'

import { useMessageListActions, useMessageListUi } from '../MessageListProvider'

const logger = loggerService.withContext('SiblingNavigator')

interface Props {
  messageId: string
}

const SiblingNavigator: FC<Props> = ({ messageId }) => {
  const { t } = useTranslation()
  const actions = useMessageListActions()
  const messageUi = useMessageListUi()
  const siblings = messageUi.getMessageSiblings?.(messageId)

  const switchTo = useCallback(
    async (targetId: string) => {
      if (!actions.setActiveBranch) return
      try {
        await actions.setActiveBranch(targetId)
      } catch (error) {
        logger.error('Failed to switch sibling branch', error as Error)
        actions.notifyError?.(error instanceof Error ? error.message : String(error))
      }
    },
    [actions]
  )

  const handleSwitch = useCallback(
    async (direction: -1 | 1) => {
      if (!siblings) return
      const { group, activeIndex } = siblings
      await switchTo(group[(activeIndex + direction + group.length) % group.length].id)
    },
    [siblings, switchTo]
  )

  if (!siblings) return null

  const { group, activeIndex } = siblings

  return (
    <div className="inline-flex items-center gap-0.5 text-[11px] leading-none text-muted-foreground select-none">
      <button
        type="button"
        className="flex size-4.5 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => void handleSwitch(-1)}
        aria-label={t('common.previous')}>
        <ChevronLeft size={12} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="min-w-8 rounded text-center font-mono tabular-nums transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('chat.message.branches')}>
            {activeIndex + 1}/{group.length}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-16">
          {group.map((item, index) => (
            <DropdownMenuItem
              key={item.id}
              className={index === activeIndex ? 'font-medium' : undefined}
              onSelect={() => {
                if (index !== activeIndex) void switchTo(item.id)
              }}>
              {index + 1}/{group.length}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className="flex size-4.5 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => void handleSwitch(1)}
        aria-label={t('common.next')}>
        <ChevronRight size={12} />
      </button>
    </div>
  )
}

export default SiblingNavigator

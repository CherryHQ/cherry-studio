/**
 * `< i/N >` navigator rendered next to a user message that belongs to a
 * sibling group (i.e. an alternate-branch group created via the edit-and-
 * resend flow). Clicking the arrows flips the topic's `activeNodeId` to the
 * previous / next branch; the messages pane revalidates and re-renders.
 */

import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { type FC, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'

import { useMessageListActions, useMessageListUi } from '../MessageListProvider'

const logger = loggerService.withContext('SiblingNavigator')

interface Props {
  messageId: string
}

const SiblingNavigator: FC<Props> = ({ messageId }) => {
  const currentItemRef = useRef<HTMLDivElement>(null)
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
            className="inline-flex min-w-8 items-center justify-center gap-1 rounded px-1 py-0.5 tabular-nums transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
            aria-label={t('chat.message.branches')}>
            {activeIndex + 1}/{group.length}
            <ChevronDown size={10} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-80 w-72 max-w-[calc(100vw-2rem)]"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            currentItemRef.current?.focus()
          }}>
          <DropdownMenuLabel>{t('chat.message.branches')}</DropdownMenuLabel>
          {group.map((item, index) => (
            <DropdownMenuItem
              key={item.id}
              ref={index === activeIndex ? currentItemRef : undefined}
              className={index === activeIndex ? 'bg-accent' : undefined}
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
              title={item.preview}
              onSelect={() => {
                if (index !== activeIndex) void switchTo(item.id)
              }}>
              <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{item.preview || `${index + 1}/${group.length}`}</span>
              <span className="w-4 shrink-0">{index === activeIndex && <Check size={14} />}</span>
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

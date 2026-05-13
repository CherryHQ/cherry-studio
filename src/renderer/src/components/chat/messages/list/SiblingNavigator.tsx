/**
 * `< i/N >` navigator rendered next to a user message that belongs to a
 * sibling group (i.e. an alternate-branch group created via the edit-and-
 * resend flow). Clicking the arrows flips the topic's `activeNodeId` to the
 * previous / next branch; the messages pane revalidates and re-renders.
 */

import { loggerService } from '@logger'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageList } from '../MessageListProvider'

const logger = loggerService.withContext('SiblingNavigator')

interface Props {
  messageId: string
}

const SiblingNavigator: FC<Props> = ({ messageId }) => {
  const { t } = useTranslation()
  const { state, actions } = useMessageList()
  const siblings = state.getMessageSiblings?.(messageId)

  const handleSwitch = useCallback(
    async (direction: -1 | 1) => {
      if (!siblings || !actions.setActiveBranch) return
      const { group, activeIndex } = siblings
      const nextIndex = (activeIndex + direction + group.length) % group.length
      const target = group[nextIndex]
      try {
        await actions.setActiveBranch(target.id)
      } catch (error) {
        logger.error('Failed to switch sibling branch', error as Error)
      }
    },
    [actions, siblings]
  )

  if (!siblings) return null

  const { group, activeIndex } = siblings

  return (
    <div className="inline-flex select-none items-center gap-0.5 text-[11px] text-foreground-secondary leading-none">
      <button
        type="button"
        className="flex size-4.5 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => void handleSwitch(-1)}
        aria-label={t('common.previous')}>
        <ChevronLeft size={12} />
      </button>
      <span className="min-w-8 text-center font-mono tabular-nums">
        {activeIndex + 1}/{group.length}
      </span>
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

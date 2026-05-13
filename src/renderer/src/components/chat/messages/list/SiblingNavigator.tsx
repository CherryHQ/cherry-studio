/**
 * `< i/N >` navigator rendered next to a user message that belongs to a
 * sibling group (i.e. an alternate-branch group created via the edit-and-
 * resend flow). Clicking the arrows flips the topic's `activeNodeId` to the
 * previous / next branch; the messages pane revalidates and re-renders.
 */

import { loggerService } from '@logger'
import { useMessageSiblings } from '@renderer/hooks/SiblingsContext'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SiblingNavigator')

interface Props {
  messageId: string
}

const SiblingNavigator: FC<Props> = ({ messageId }) => {
  const { t } = useTranslation()
  const siblings = useMessageSiblings(messageId)
  const v2 = useV2Chat()

  const handleSwitch = useCallback(
    async (direction: -1 | 1) => {
      if (!siblings || !v2) return
      const { group, activeIndex } = siblings
      const nextIndex = (activeIndex + direction + group.length) % group.length
      const target = group[nextIndex]
      try {
        await v2.setActiveBranch(target.id)
      } catch (error) {
        logger.error('Failed to switch sibling branch', error as Error)
      }
    },
    [siblings, v2]
  )

  if (!siblings) return null

  const { group, activeIndex } = siblings

  return (
    <div className="inline-flex select-none items-center gap-1 text-(--color-text-2) text-xs">
      <button
        type="button"
        className="flex size-5 items-center justify-center rounded transition-colors hover:bg-(--color-background-soft) hover:text-(--color-text-1)"
        onClick={() => void handleSwitch(-1)}
        aria-label={t('common.previous')}>
        <ChevronLeft size={14} />
      </button>
      <span className="min-w-10 text-center font-mono tabular-nums">
        {activeIndex + 1}/{group.length}
      </span>
      <button
        type="button"
        className="flex size-5 items-center justify-center rounded transition-colors hover:bg-(--color-background-soft) hover:text-(--color-text-1)"
        onClick={() => void handleSwitch(1)}
        aria-label={t('common.next')}>
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

export default SiblingNavigator

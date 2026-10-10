import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@cherrystudio/ui/lib/utils'

import { useMessageListActions, useMessageListMeta, useMessageRenderConfig } from '../MessageListProvider'
import MessageAvatar from './MessageAvatar'

/** User content geometry shared by submitted messages and transient attachments. */
export function MessageUserLayout({ children }: { children: ReactNode }) {
  const actions = useMessageListActions()
  const meta = useMessageListMeta()
  const config = useMessageRenderConfig()
  const { t } = useTranslation()
  const bubble = config.messageStyle === 'bubble'
  return (
    <div className={cn('flex w-full', bubble && 'justify-end')}>
      <div
        className={cn(
          'flex min-w-0 items-start gap-2.5',
          bubble ? 'max-w-[calc(100%-2.5rem)] justify-end has-[.code-block]:w-full' : 'w-full flex-row-reverse'
        )}>
        <div className={cn('flex min-w-0 flex-1 flex-col', bubble && 'items-end')}>
          {!bubble && <div className="mb-2 font-semibold text-sm">{config.userName || t('common.you')}</div>}
          {children}
        </div>
        <MessageAvatar
          avatar={meta.userProfile?.avatar ?? ''}
          className={bubble ? 'mt-1.5' : undefined}
          onClick={
            actions.openUserProfile
              ? () => {
                  void actions.openUserProfile?.()
                }
              : undefined
          }
        />
      </div>
    </div>
  )
}

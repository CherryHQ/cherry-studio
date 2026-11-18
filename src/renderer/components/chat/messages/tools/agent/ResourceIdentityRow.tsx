import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmojiAvatar } from '@cherrystudio/ui'
import { AssistantAvatarImage } from '@renderer/components/Avatar/AssistantAvatarImage'
import { DEFAULT_AGENT_CREATE_AVATAR } from '@shared/ai/agentCreateCommand'
import { DEFAULT_ASSISTANT_CREATE_AVATAR } from '@shared/ai/assistantCreateDto'

/** Avatar, name, kind and one meta line: the identity shared by the result card and the create approval. */
export function ResourceIdentityRow({
  kind,
  name,
  emoji,
  avatarSrc,
  meta,
  badge,
  children
}: {
  kind: 'agent' | 'assistant'
  name: string
  /** Empty falls back to the kind's default avatar. */
  emoji: string
  /** An uploaded avatar, shown instead of the emoji. */
  avatarSrc?: string
  meta: ReactNode
  badge?: ReactNode
  /** Trailing actions. */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const fallbackEmoji = kind === 'agent' ? DEFAULT_AGENT_CREATE_AVATAR : DEFAULT_ASSISTANT_CREATE_AVATAR

  return (
    <div className="flex items-center gap-2.5">
      <AssistantAvatarImage
        src={avatarSrc}
        alt=""
        size={32}
        className="shrink-0 rounded-lg border border-border-subtle object-cover"
        fallback={
          <EmojiAvatar
            size={32}
            fontSize={17}
            className="shrink-0 cursor-default rounded-lg border border-border-subtle bg-background hover:opacity-100">
            {emoji || fallbackEmoji}
          </EmojiAvatar>
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-[13px] text-foreground leading-5" title={name}>
            {name}
          </span>
          <span className="shrink-0 text-[11px] text-foreground-tertiary leading-5">
            {kind === 'agent' ? t('library.type.agent') : t('library.type.assistant')}
          </span>
          {badge}
        </div>
        {meta ? (
          <div
            className="truncate text-muted-foreground text-xs leading-4"
            title={typeof meta === 'string' ? meta : undefined}>
            {meta}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}

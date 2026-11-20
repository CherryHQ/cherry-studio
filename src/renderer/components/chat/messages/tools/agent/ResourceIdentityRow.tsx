import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmojiAvatar } from '@cherrystudio/ui'
import { AssistantAvatarImage } from '@renderer/components/Avatar/AssistantAvatarImage'
import { DEFAULT_AGENT_CREATE_AVATAR } from '@shared/ai/agentCreateCommand'
import { DEFAULT_ASSISTANT_CREATE_AVATAR } from '@shared/ai/assistantCreateDto'

/** An Agent's or Assistant's avatar: its uploaded image, else its emoji, else the kind's default. */
export function ResourceAvatar({
  kind,
  emoji,
  avatarSrc,
  size
}: {
  kind: 'agent' | 'assistant'
  emoji: string
  avatarSrc?: string
  size: number
}) {
  const fallbackEmoji = kind === 'agent' ? DEFAULT_AGENT_CREATE_AVATAR : DEFAULT_ASSISTANT_CREATE_AVATAR
  return (
    <AssistantAvatarImage
      src={avatarSrc}
      alt=""
      size={size}
      className="shrink-0 rounded-lg border border-border-subtle object-cover"
      fallback={
        <EmojiAvatar
          size={size}
          fontSize={Math.round(size * 0.53)}
          className="shrink-0 cursor-default rounded-lg border border-border-subtle bg-background hover:opacity-100">
          {emoji || fallbackEmoji}
        </EmojiAvatar>
      }
    />
  )
}

/** Avatar, name, kind and one meta line: the identity the create approval shows. */
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

  return (
    // The name keeps a readable width; on a narrow card the trailing actions wrap below it instead.
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <ResourceAvatar kind={kind} emoji={emoji} avatarSrc={avatarSrc} size={32} />
      <div className="min-w-40 flex-1">
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

import type { AvatarProps as HeroUIAvatarProps } from '@heroui/react'
import { Avatar as HeroUIAvatar, AvatarGroup as HeroUIAvatarGroup } from '@heroui/react'

import { cn } from '../../../utils'
import EmojiAvatar from './EmojiAvatar'

export interface AvatarProps extends Omit<HeroUIAvatarProps, 'size'> {
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const Avatar = (props: AvatarProps) => {
  const { size, className = '', ...rest } = props
  const isExtraSmall = size === 'xs'

  const resolvedSize = isExtraSmall ? undefined : size
  const mergedClassName = cn(isExtraSmall && 'w-6 h-6 text-tiny', 'shadow-lg', className)

  return <HeroUIAvatar size={resolvedSize} className={mergedClassName} {...rest} />
}

Avatar.displayName = 'Avatar'

/**
 * @deprecated 此组件使用频率仅为 1 次，不符合 UI 库提取标准（需 ≥3 次）
 * 计划在未来版本中移除。建议直接使用 HeroUI 的 AvatarGroup 组件。
 *
 * This component has only 1 usage and does not meet the UI library extraction criteria (requires ≥3 usages).
 * Planned for removal in future versions. Consider using HeroUI's AvatarGroup component directly.
 */
const AvatarGroup = HeroUIAvatarGroup

AvatarGroup.displayName = 'AvatarGroup'

export { Avatar, AvatarGroup, EmojiAvatar }

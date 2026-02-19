import type { CompoundIcon } from '@cherrystudio/ui'
import { Avatar } from '@cherrystudio/ui'
import type { FC } from 'react'

interface Props {
  logo: string | object | undefined
  size?: number
  shape?: 'circle' | 'rounded'
  className?: string
}

/**
 * Renders either a CompoundIcon avatar or a plain image avatar,
 * depending on whether the logo is a CompoundIcon or a string URL.
 */
const LogoAvatar: FC<Props> = ({ logo, size = 32, shape = 'rounded', className }) => {
  if (!logo) return null

  if (typeof logo !== 'string') {
    const Icon = logo as CompoundIcon
    return <Icon.Avatar size={size} shape={shape} className={className} />
  }

  return <Avatar src={logo} className={className} style={{ width: size, height: size }} />
}

export default LogoAvatar

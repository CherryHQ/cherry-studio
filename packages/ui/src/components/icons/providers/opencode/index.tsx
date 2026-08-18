import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenCodeGoAvatar } from './avatar'
import { OpenCodeGoLight } from './light'

const OpenCodeGo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenCodeGoLight {...props} className={className} />
  return <OpenCodeGoLight {...props} className={className} />
}

export const OpenCodeGoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(OpenCodeGo, {
  Avatar: OpenCodeGoAvatar,
  colorPrimary: '#131010'
})

export default OpenCodeGoIcon

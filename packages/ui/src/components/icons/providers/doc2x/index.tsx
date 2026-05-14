import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Doc2xAvatar } from './avatar'
import { Doc2xLight } from './light'

const Doc2x = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Doc2xLight {...props} className={className} />
  return <Doc2xLight {...props} className={className} />
}

export const Doc2xIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doc2x, {
  Avatar: Doc2xAvatar,
  colorPrimary: '#7748F9'
})

export default Doc2xIcon

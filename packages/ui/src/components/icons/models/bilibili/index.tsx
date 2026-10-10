import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BilibiliAvatar } from './avatar'
import { BilibiliLight } from './light'

const Bilibili = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BilibiliLight {...props} className={className} />
  return <BilibiliLight {...props} className={className} />
}

export const BilibiliIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bilibili, {
  Avatar: BilibiliAvatar,
  colorPrimary: '#FB7299'
})

export default BilibiliIcon

import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NeteaseYoudaoAvatar } from './avatar'
import { NeteaseYoudaoLight } from './light'

const NeteaseYoudao = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NeteaseYoudaoLight {...props} className={className} />
  return <NeteaseYoudaoLight {...props} className={className} />
}

export const NeteaseYoudaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NeteaseYoudao, {
  Avatar: NeteaseYoudaoAvatar,
  colorPrimary: '#e01e00'
})

export default NeteaseYoudaoIcon

import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NeteaseYoudaoAvatar } from './avatar'
import { NeteaseYoudaoLight } from './light'

const NeteaseYoudao = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NeteaseYoudaoLight {...props} className={className} />
  return <NeteaseYoudaoLight {...props} className={className} />
}

export const NeteaseYoudaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NeteaseYoudao, {
  Avatar: NeteaseYoudaoAvatar,
  colorPrimary: '#E01E00'
})

export default NeteaseYoudaoIcon

import type { CompoundIcon, CompoundIconProps } from '../../types'
import { McprouterAvatar } from './avatar'
import { McprouterLight } from './light'

const Mcprouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <McprouterLight {...props} className={className} />
  return <McprouterLight {...props} className={className} />
}

export const McprouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcprouter, {
  Avatar: McprouterAvatar,
  colorPrimary: '#004AAD'
})

export default McprouterIcon

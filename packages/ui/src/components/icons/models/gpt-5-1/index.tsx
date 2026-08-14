import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51Avatar } from './avatar'
import { Gpt51Light } from './light'

const Gpt51 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51Light {...props} className={className} />
  return <Gpt51Light {...props} className={className} />
}

export const Gpt51Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51, {
  Avatar: Gpt51Avatar,
  colorPrimary: '#000000'
})

export default Gpt51Icon

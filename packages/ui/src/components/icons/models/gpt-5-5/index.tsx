import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt55Avatar } from './avatar'
import { Gpt55Light } from './light'

const Gpt55 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt55Light {...props} className={className} />
  return <Gpt55Light {...props} className={className} />
}

export const Gpt55Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt55, {
  Avatar: Gpt55Avatar,
  colorPrimary: '#000000'
})

export default Gpt55Icon

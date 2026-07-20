import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4Avatar } from './avatar'
import { Gpt4Light } from './light'

const Gpt4 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4Light {...props} className={className} />
  return <Gpt4Light {...props} className={className} />
}

export const Gpt4Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4, {
  Avatar: Gpt4Avatar,
  colorPrimary: '#000000'
})

export default Gpt4Icon

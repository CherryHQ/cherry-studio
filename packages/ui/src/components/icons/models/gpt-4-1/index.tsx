import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt41Avatar } from './avatar'
import { Gpt41Light } from './light'

const Gpt41 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt41Light {...props} className={className} />
  return <Gpt41Light {...props} className={className} />
}

export const Gpt41Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt41, {
  Avatar: Gpt41Avatar,
  colorPrimary: '#000000'
})

export default Gpt41Icon

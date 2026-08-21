import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt54Avatar } from './avatar'
import { Gpt54Light } from './light'

const Gpt54 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt54Light {...props} className={className} />
  return <Gpt54Light {...props} className={className} />
}

export const Gpt54Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt54, {
  Avatar: Gpt54Avatar,
  colorPrimary: '#000000'
})

export default Gpt54Icon

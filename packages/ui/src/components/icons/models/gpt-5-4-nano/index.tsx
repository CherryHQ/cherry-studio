import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt54NanoAvatar } from './avatar'
import { Gpt54NanoLight } from './light'

const Gpt54Nano = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt54NanoLight {...props} className={className} />
  return <Gpt54NanoLight {...props} className={className} />
}

export const Gpt54NanoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt54Nano, {
  Avatar: Gpt54NanoAvatar,
  colorPrimary: '#000000'
})

export default Gpt54NanoIcon

import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt52ChatLatestAvatar } from './avatar'
import { Gpt52ChatLatestLight } from './light'

const Gpt52ChatLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt52ChatLatestLight {...props} className={className} />
  return <Gpt52ChatLatestLight {...props} className={className} />
}

export const Gpt52ChatLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52ChatLatest, {
  Avatar: Gpt52ChatLatestAvatar,
  colorPrimary: '#000000'
})

export default Gpt52ChatLatestIcon

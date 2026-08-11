import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5ChatLatestAvatar } from './avatar'
import { Gpt5ChatLatestLight } from './light'

const Gpt5ChatLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5ChatLatestLight {...props} className={className} />
  return <Gpt5ChatLatestLight {...props} className={className} />
}

export const Gpt5ChatLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5ChatLatest, {
  Avatar: Gpt5ChatLatestAvatar,
  colorPrimary: '#000000'
})

export default Gpt5ChatLatestIcon

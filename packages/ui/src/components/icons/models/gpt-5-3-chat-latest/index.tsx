import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt53ChatLatestAvatar } from './avatar'
import { Gpt53ChatLatestLight } from './light'

const Gpt53ChatLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt53ChatLatestLight {...props} className={className} />
  return <Gpt53ChatLatestLight {...props} className={className} />
}

export const Gpt53ChatLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt53ChatLatest, {
  Avatar: Gpt53ChatLatestAvatar,
  colorPrimary: '#000000'
})

export default Gpt53ChatLatestIcon

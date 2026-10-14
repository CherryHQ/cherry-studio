import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51ChatLatestAvatar } from './avatar'
import { Gpt51ChatLatestLight } from './light'

const Gpt51ChatLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51ChatLatestLight {...props} className={className} />
  return <Gpt51ChatLatestLight {...props} className={className} />
}

export const Gpt51ChatLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51ChatLatest, {
  Avatar: Gpt51ChatLatestAvatar,
  colorPrimary: '#000000'
})

export default Gpt51ChatLatestIcon

import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PerplexityAvatar } from './avatar'
import { PerplexityLight } from './light'

const Perplexity = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PerplexityLight {...props} className={className} />
  return <PerplexityLight {...props} className={className} />
}

export const PerplexityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Perplexity, {
  Avatar: PerplexityAvatar,
  colorPrimary: '#22B8CD'
})

export default PerplexityIcon

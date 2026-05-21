import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SearxngAvatar } from './avatar'
import { SearxngLight } from './light'

const Searxng = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SearxngLight {...props} className={className} />
  return <SearxngLight {...props} className={className} />
}

export const SearxngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Searxng, {
  Avatar: SearxngAvatar,
  colorPrimary: '#3050FF'
})

export default SearxngIcon

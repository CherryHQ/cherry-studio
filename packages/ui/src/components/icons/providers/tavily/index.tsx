import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TavilyAvatar } from './avatar'
import { TavilyLight } from './light'

const Tavily = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TavilyLight {...props} className={className} />
  return <TavilyLight {...props} className={className} />
}

export const TavilyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tavily, {
  Avatar: TavilyAvatar,
  colorPrimary: '#8FBCFA'
})

export default TavilyIcon

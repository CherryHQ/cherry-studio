import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FirecrawlAvatar } from './avatar'
import { FirecrawlLight } from './light'

const Firecrawl = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FirecrawlLight {...props} className={className} />
  return <FirecrawlLight {...props} className={className} />
}

export const FirecrawlIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Firecrawl, {
  Avatar: FirecrawlAvatar,
  colorPrimary: '#FA5D19'
})

export default FirecrawlIcon

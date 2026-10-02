import type { CompoundIcon, CompoundIconProps } from '../../types'
import { YApiAvatar } from './avatar'
import { YApiLight } from './light'

const YApi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <YApiLight {...props} className={className} />
  return <YApiLight {...props} className={className} />
}

export const YApiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(YApi, {
  Avatar: YApiAvatar,
  colorPrimary: '#EE6018'
})

export default YApiIcon

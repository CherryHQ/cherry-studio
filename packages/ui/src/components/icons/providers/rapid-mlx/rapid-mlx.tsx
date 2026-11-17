import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RapidMlxAvatar } from './avatar'
import { RapidMlxLight } from './light'

const RapidMlx = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RapidMlxLight {...props} className={className} />
  return <RapidMlxLight {...props} className={className} />
}

export const RapidMlxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(RapidMlx, {
  Avatar: RapidMlxAvatar,
  colorPrimary: '#000000'
})

export default RapidMlxIcon

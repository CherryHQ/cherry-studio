import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZhipuAvatar } from './avatar'
import { ZhipuLight } from './light'

const Zhipu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZhipuLight {...props} className={className} />
  return <ZhipuLight {...props} className={className} />
}

export const ZhipuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhipu, {
  Avatar: ZhipuAvatar,
  colorPrimary: '#3859FF'
})

export default ZhipuIcon

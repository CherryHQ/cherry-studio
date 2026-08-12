import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtime2Avatar } from './avatar'
import { GptRealtime2Light } from './light'

const GptRealtime2 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtime2Light {...props} className={className} />
  return <GptRealtime2Light {...props} className={className} />
}

export const GptRealtime2Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtime2, {
  Avatar: GptRealtime2Avatar,
  colorPrimary: '#000000'
})

export default GptRealtime2Icon

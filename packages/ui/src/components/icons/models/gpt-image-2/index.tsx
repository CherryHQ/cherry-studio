import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage2Avatar } from './avatar'
import { GptImage2Light } from './light'

const GptImage2 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage2Light {...props} className={className} />
  return <GptImage2Light {...props} className={className} />
}

export const GptImage2Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage2, {
  Avatar: GptImage2Avatar,
  colorPrimary: '#000000'
})

export default GptImage2Icon

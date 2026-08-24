import type { CompoundIcon, CompoundIconProps } from '../../types'
import { JinaAvatar } from './avatar'
import { JinaLight } from './light'

const Jina = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <JinaLight {...props} className={className} />
  return <JinaLight {...props} className={className} />
}

export const JinaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jina, {
  Avatar: JinaAvatar,
  colorPrimary: '#EB6161'
})

export default JinaIcon

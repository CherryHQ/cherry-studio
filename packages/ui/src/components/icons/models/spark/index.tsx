import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SparkAvatar } from './avatar'
import { SparkLight } from './light'

const Spark = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SparkLight {...props} className={className} />
  return <SparkLight {...props} className={className} />
}

export const SparkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Spark, {
  Avatar: SparkAvatar,
  colorPrimary: '#3DC8F9'
})

export default SparkIcon

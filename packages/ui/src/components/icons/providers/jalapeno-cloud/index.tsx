import type { CompoundIcon, CompoundIconProps } from '../../types'
import { JalapenoCloudAvatar } from './avatar'
import { JalapenoCloudLight } from './light'

const JalapenoCloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <JalapenoCloudLight {...props} className={className} />
  return <JalapenoCloudLight {...props} className={className} />
}

export const JalapenoCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(JalapenoCloud, {
  Avatar: JalapenoCloudAvatar,
  colorPrimary: '#00A030'
})

export default JalapenoCloudIcon

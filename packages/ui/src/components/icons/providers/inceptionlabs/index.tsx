import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InceptionlabsAvatar } from './avatar'
import { InceptionlabsLight } from './light'

const Inceptionlabs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InceptionlabsLight {...props} className={cn('text-foreground', className)} />
  return <InceptionlabsLight {...props} className={cn('text-foreground', className)} />
}

export const InceptionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inceptionlabs, {
  Avatar: InceptionlabsAvatar,
  colorPrimary: '#000000'
})

export default InceptionlabsIcon

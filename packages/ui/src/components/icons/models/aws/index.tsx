import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AwsAvatar } from './avatar'
import { AwsLight } from './light'

const Aws = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AwsLight {...props} className={cn('text-foreground', className)} />
  return <AwsLight {...props} className={cn('text-foreground', className)} />
}

export const AwsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aws, {
  Avatar: AwsAvatar,
  colorPrimary: '#F90'
})

export default AwsIcon

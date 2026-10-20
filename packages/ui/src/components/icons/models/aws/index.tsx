import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AwsAvatar } from './avatar'
import { AwsDark } from './dark'
import { AwsLight } from './light'

const Aws = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AwsLight {...props} className={className} />
  if (variant === 'dark') return <AwsDark {...props} className={className} />
  return (
    <>
      <AwsLight className={cn('dark:hidden', className)} {...props} />
      <AwsDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AwsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aws, {
  Avatar: AwsAvatar,
  colorPrimary: '#000000'
})

export default AwsIcon

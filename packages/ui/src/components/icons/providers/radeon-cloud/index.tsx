import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RadeonCloudAvatar } from './avatar'
import { RadeonCloudDark } from './dark'
import { RadeonCloudLight } from './light'

const RadeonCloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RadeonCloudLight {...props} className={className} />

  if (variant === 'dark') return <RadeonCloudDark {...props} className={className} />

  return (
    <>
      <RadeonCloudLight className={cn('dark:hidden', className)} {...props} />
      <RadeonCloudDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const RadeonCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(RadeonCloud, {
  Avatar: RadeonCloudAvatar,
  colorPrimary: '#000000'
})

export default RadeonCloudIcon

import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { StreamlakeAvatar } from './avatar'
import { StreamlakeDark } from './dark'
import { StreamlakeLight } from './light'

const Streamlake = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <StreamlakeLight {...props} className={className} />
  if (variant === 'dark') return <StreamlakeDark {...props} className={className} />
  return (
    <>
      <StreamlakeLight className={cn('dark:hidden', className)} {...props} />
      <StreamlakeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const StreamlakeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Streamlake, {
  Avatar: StreamlakeAvatar,
  colorPrimary: '#1D70FF'
})

export default StreamlakeIcon

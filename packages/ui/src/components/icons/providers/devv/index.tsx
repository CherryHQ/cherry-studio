import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DevvAvatar } from './avatar'
import { DevvDark } from './dark'
import { DevvLight } from './light'

const Devv = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DevvLight {...props} className={className} />
  if (variant === 'dark') return <DevvDark {...props} className={className} />
  return (
    <>
      <DevvLight className={cn('dark:hidden', className)} {...props} />
      <DevvDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DevvIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Devv, {
  Avatar: DevvAvatar,
  colorPrimary: '#101828'
})

export default DevvIcon

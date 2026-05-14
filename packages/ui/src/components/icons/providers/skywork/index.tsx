import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SkyworkAvatar } from './avatar'
import { SkyworkDark } from './dark'
import { SkyworkLight } from './light'

const Skywork = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SkyworkLight {...props} className={className} />
  if (variant === 'dark') return <SkyworkDark {...props} className={className} />
  return (
    <>
      <SkyworkLight className={cn('dark:hidden', className)} {...props} />
      <SkyworkDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SkyworkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Skywork, {
  Avatar: SkyworkAvatar,
  colorPrimary: '#4D5EFF'
})

export default SkyworkIcon

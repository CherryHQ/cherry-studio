import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OcoolaiAvatar } from './avatar'
import { OcoolaiDark } from './dark'
import { OcoolaiLight } from './light'

const Ocoolai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OcoolaiLight {...props} className={className} />
  if (variant === 'dark') return <OcoolaiDark {...props} className={className} />
  return (
    <>
      <OcoolaiLight className={cn('dark:hidden', className)} {...props} />
      <OcoolaiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OcoolaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ocoolai, {
  Avatar: OcoolaiAvatar,
  colorPrimary: '#000000'
})

export default OcoolaiIcon

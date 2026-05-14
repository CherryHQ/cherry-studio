import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VercelAvatar } from './avatar'
import { VercelDark } from './dark'
import { VercelLight } from './light'

const Vercel = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VercelLight {...props} className={className} />
  if (variant === 'dark') return <VercelDark {...props} className={className} />
  return (
    <>
      <VercelLight className={cn('dark:hidden', className)} {...props} />
      <VercelDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const VercelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vercel, {
  Avatar: VercelAvatar,
  colorPrimary: '#000000'
})

export default VercelIcon

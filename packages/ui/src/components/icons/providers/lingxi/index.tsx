import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LingxiAvatar } from './avatar'
import { LingxiDark } from './dark'
import { LingxiLight } from './light'

const Lingxi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LingxiLight {...props} className={className} />
  if (variant === 'dark') return <LingxiDark {...props} className={className} />
  return (
    <>
      <LingxiLight className={cn('dark:hidden', className)} {...props} />
      <LingxiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LingxiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lingxi, {
  Avatar: LingxiAvatar,
  colorPrimary: '#000000'
})

export default LingxiIcon

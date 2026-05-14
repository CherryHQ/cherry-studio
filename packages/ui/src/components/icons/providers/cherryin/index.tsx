import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CherryinAvatar } from './avatar'
import { CherryinDark } from './dark'
import { CherryinLight } from './light'

const Cherryin = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CherryinLight {...props} className={className} />
  if (variant === 'dark') return <CherryinDark {...props} className={className} />
  return (
    <>
      <CherryinLight className={cn('dark:hidden', className)} {...props} />
      <CherryinDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CherryinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cherryin, {
  Avatar: CherryinAvatar,
  colorPrimary: '#FF5F5F'
})

export default CherryinIcon

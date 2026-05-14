import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QueritAvatar } from './avatar'
import { QueritDark } from './dark'
import { QueritLight } from './light'

const Querit = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QueritLight {...props} className={className} />
  if (variant === 'dark') return <QueritDark {...props} className={className} />
  return (
    <>
      <QueritLight className={cn('dark:hidden', className)} {...props} />
      <QueritDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const QueritIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Querit, {
  Avatar: QueritAvatar,
  colorPrimary: '#FDFEFF'
})

export default QueritIcon

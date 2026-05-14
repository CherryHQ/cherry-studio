import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AlayanewAvatar } from './avatar'
import { AlayanewDark } from './dark'
import { AlayanewLight } from './light'

const Alayanew = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AlayanewLight {...props} className={className} />
  if (variant === 'dark') return <AlayanewDark {...props} className={className} />
  return (
    <>
      <AlayanewLight className={cn('dark:hidden', className)} {...props} />
      <AlayanewDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AlayanewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Alayanew, {
  Avatar: AlayanewAvatar,
  colorPrimary: '#4362FF'
})

export default AlayanewIcon

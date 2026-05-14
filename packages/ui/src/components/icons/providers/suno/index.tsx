import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SunoAvatar } from './avatar'
import { SunoDark } from './dark'
import { SunoLight } from './light'

const Suno = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SunoLight {...props} className={className} />
  if (variant === 'dark') return <SunoDark {...props} className={className} />
  return (
    <>
      <SunoLight className={cn('dark:hidden', className)} {...props} />
      <SunoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SunoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Suno, {
  Avatar: SunoAvatar,
  colorPrimary: '#FEFEFE'
})

export default SunoIcon

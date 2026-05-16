import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NomicAvatar } from './avatar'
import { NomicDark } from './dark'
import { NomicLight } from './light'

const Nomic = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NomicLight {...props} className={className} />
  if (variant === 'dark') return <NomicDark {...props} className={className} />
  return (
    <>
      <NomicLight className={cn('dark:hidden', className)} {...props} />
      <NomicDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NomicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nomic, {
  Avatar: NomicAvatar,
  colorPrimary: '#000000'
})

export default NomicIcon

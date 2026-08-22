import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { KimiAvatar } from './avatar'
import { KimiDark } from './dark'
import { KimiLight } from './light'

const Kimi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <KimiLight {...props} className={className} />
  if (variant === 'dark') return <KimiDark {...props} className={className} />
  return (
    <>
      <KimiLight className={cn('dark:hidden', className)} {...props} />
      <KimiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const KimiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kimi, {
  Avatar: KimiAvatar,
  colorPrimary: '#000000'
})

export default KimiIcon

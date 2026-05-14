import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SensenovaAvatar } from './avatar'
import { SensenovaDark } from './dark'
import { SensenovaLight } from './light'

const Sensenova = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SensenovaLight {...props} className={className} />
  if (variant === 'dark') return <SensenovaDark {...props} className={className} />
  return (
    <>
      <SensenovaLight className={cn('dark:hidden', className)} {...props} />
      <SensenovaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SensenovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensenova, {
  Avatar: SensenovaAvatar,
  colorPrimary: '#01FFB9'
})

export default SensenovaIcon

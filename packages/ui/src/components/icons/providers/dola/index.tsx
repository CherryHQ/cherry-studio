import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DolaAvatar } from './avatar'
import { DolaDark } from './dark'
import { DolaLight } from './light'

const Dola = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DolaLight {...props} className={className} />
  if (variant === 'dark') return <DolaDark {...props} className={className} />
  return (
    <>
      <DolaLight className={cn('dark:hidden', className)} {...props} />
      <DolaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DolaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dola, {
  Avatar: DolaAvatar,
  colorPrimary: '#000000'
})

export default DolaIcon

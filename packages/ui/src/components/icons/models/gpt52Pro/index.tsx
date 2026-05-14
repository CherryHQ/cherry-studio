import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt52ProAvatar } from './avatar'
import { Gpt52ProDark } from './dark'
import { Gpt52ProLight } from './light'

const Gpt52Pro = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt52ProLight {...props} className={className} />
  if (variant === 'dark') return <Gpt52ProDark {...props} className={className} />
  return (
    <>
      <Gpt52ProLight className={cn('dark:hidden', className)} {...props} />
      <Gpt52ProDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt52ProIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52Pro, {
  Avatar: Gpt52ProAvatar,
  colorPrimary: '#000000'
})

export default Gpt52ProIcon

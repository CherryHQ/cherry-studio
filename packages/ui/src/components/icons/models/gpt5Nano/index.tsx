import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5NanoAvatar } from './avatar'
import { Gpt5NanoDark } from './dark'
import { Gpt5NanoLight } from './light'

const Gpt5Nano = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5NanoLight {...props} className={className} />
  if (variant === 'dark') return <Gpt5NanoDark {...props} className={className} />
  return (
    <>
      <Gpt5NanoLight className={cn('dark:hidden', className)} {...props} />
      <Gpt5NanoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt5NanoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Nano, {
  Avatar: Gpt5NanoAvatar,
  colorPrimary: '#000000'
})

export default Gpt5NanoIcon

import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HuggingfaceAvatar } from './avatar'
import { HuggingfaceDark } from './dark'
import { HuggingfaceLight } from './light'

const Huggingface = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HuggingfaceLight {...props} className={className} />
  if (variant === 'dark') return <HuggingfaceDark {...props} className={className} />
  return (
    <>
      <HuggingfaceLight className={cn('dark:hidden', className)} {...props} />
      <HuggingfaceDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HuggingfaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Huggingface, {
  Avatar: HuggingfaceAvatar,
  colorPrimary: '#FF9D0B'
})

export default HuggingfaceIcon

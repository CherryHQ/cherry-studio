import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GemmaAvatar } from './avatar'
import { GemmaDark } from './dark'
import { GemmaLight } from './light'

const Gemma = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GemmaLight {...props} className={className} />
  if (variant === 'dark') return <GemmaDark {...props} className={className} />
  return (
    <>
      <GemmaLight className={cn('dark:hidden', className)} {...props} />
      <GemmaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GemmaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemma, {
  Avatar: GemmaAvatar,
  colorPrimary: '#53A3FF'
})

export default GemmaIcon

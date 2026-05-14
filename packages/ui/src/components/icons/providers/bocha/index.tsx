import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BochaAvatar } from './avatar'
import { BochaDark } from './dark'
import { BochaLight } from './light'

const Bocha = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BochaLight {...props} className={className} />
  if (variant === 'dark') return <BochaDark {...props} className={className} />
  return (
    <>
      <BochaLight className={cn('dark:hidden', className)} {...props} />
      <BochaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BochaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bocha, {
  Avatar: BochaAvatar,
  colorPrimary: '#A5CCFF'
})

export default BochaIcon

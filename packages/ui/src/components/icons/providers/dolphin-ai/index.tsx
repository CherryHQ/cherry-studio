import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DolphinAiAvatar } from './avatar'
import { DolphinAiDark } from './dark'
import { DolphinAiLight } from './light'

const DolphinAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DolphinAiLight {...props} className={className} />
  if (variant === 'dark') return <DolphinAiDark {...props} className={className} />
  return (
    <>
      <DolphinAiLight className={cn('dark:hidden', className)} {...props} />
      <DolphinAiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DolphinAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(DolphinAi, {
  Avatar: DolphinAiAvatar,
  colorPrimary: '#000'
})

export default DolphinAiIcon

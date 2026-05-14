import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QwenAvatar } from './avatar'
import { QwenDark } from './dark'
import { QwenLight } from './light'

const Qwen = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QwenLight {...props} className={className} />
  if (variant === 'dark') return <QwenDark {...props} className={className} />
  return (
    <>
      <QwenLight className={cn('dark:hidden', className)} {...props} />
      <QwenDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const QwenIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qwen, {
  Avatar: QwenAvatar,
  colorPrimary: '#615CED'
})

export default QwenIcon

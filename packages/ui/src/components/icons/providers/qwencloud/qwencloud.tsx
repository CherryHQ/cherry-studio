import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QwencloudAvatar } from './avatar'
import { QwencloudDark } from './dark'
import { QwencloudLight } from './light'

const Qwencloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QwencloudLight {...props} className={className} />
  if (variant === 'dark') return <QwencloudDark {...props} className={className} />
  return (
    <>
      <QwencloudLight className={cn('dark:hidden', className)} {...props} />
      <QwencloudDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const QwencloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qwencloud, {
  Avatar: QwencloudAvatar,
  colorPrimary: '#000000'
})

export default QwencloudIcon

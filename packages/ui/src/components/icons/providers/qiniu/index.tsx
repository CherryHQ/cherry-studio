import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QiniuAvatar } from './avatar'
import { QiniuDark } from './dark'
import { QiniuLight } from './light'

const Qiniu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QiniuLight {...props} className={className} />
  if (variant === 'dark') return <QiniuDark {...props} className={className} />
  return (
    <>
      <QiniuLight className={cn('dark:hidden', className)} {...props} />
      <QiniuDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const QiniuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qiniu, {
  Avatar: QiniuAvatar,
  colorPrimary: '#06AEEF'
})

export default QiniuIcon

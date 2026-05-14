import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { QiniuAvatar } from './avatar'
import { QiniuDark } from './dark'
import { QiniuLight } from './light'

const Qiniu = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <QiniuLight className={cn('dark:hidden', className)} {...props} />
    <QiniuDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const QiniuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qiniu, {
  Light: QiniuLight,
  Dark: QiniuDark,
  Avatar: QiniuAvatar,
  colorPrimary: '#06AEEF'
})

export default QiniuIcon

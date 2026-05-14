import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { QwenAvatar } from './avatar'
import { QwenDark } from './dark'
import { QwenLight } from './light'

const Qwen = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <QwenLight className={cn('dark:hidden', className)} {...props} />
    <QwenDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const QwenIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qwen, {
  Light: QwenLight,
  Dark: QwenDark,
  Avatar: QwenAvatar,
  colorPrimary: '#000000'
})

export default QwenIcon

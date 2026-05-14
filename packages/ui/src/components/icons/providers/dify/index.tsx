import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DifyAvatar } from './avatar'
import { DifyDark } from './dark'
import { DifyLight } from './light'

const Dify = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DifyLight className={cn('dark:hidden', className)} {...props} />
    <DifyDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DifyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dify, {
  Light: DifyLight,
  Dark: DifyDark,
  Avatar: DifyAvatar,
  colorPrimary: '#FDFEFF'
})

export default DifyIcon

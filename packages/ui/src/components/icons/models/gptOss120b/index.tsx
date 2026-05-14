import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GptOss120bAvatar } from './avatar'
import { GptOss120bDark } from './dark'
import { GptOss120bLight } from './light'

const GptOss120b = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GptOss120bLight className={cn('dark:hidden', className)} {...props} />
    <GptOss120bDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GptOss120bIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptOss120b, {
  Light: GptOss120bLight,
  Dark: GptOss120bDark,
  Avatar: GptOss120bAvatar,
  colorPrimary: '#000000'
})

export default GptOss120bIcon

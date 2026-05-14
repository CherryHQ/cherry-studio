import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GptOss20bAvatar } from './avatar'
import { GptOss20bDark } from './dark'
import { GptOss20bLight } from './light'

const GptOss20b = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GptOss20bLight className={cn('dark:hidden', className)} {...props} />
    <GptOss20bDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GptOss20bIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptOss20b, {
  Light: GptOss20bLight,
  Dark: GptOss20bDark,
  Avatar: GptOss20bAvatar,
  colorPrimary: '#000000'
})

export default GptOss20bIcon

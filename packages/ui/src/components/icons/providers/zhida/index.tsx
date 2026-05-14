import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ZhidaAvatar } from './avatar'
import { ZhidaDark } from './dark'
import { ZhidaLight } from './light'

const Zhida = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ZhidaLight className={cn('dark:hidden', className)} {...props} />
    <ZhidaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ZhidaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhida, {
  Light: ZhidaLight,
  Dark: ZhidaDark,
  Avatar: ZhidaAvatar,
  colorPrimary: '#000000'
})

export default ZhidaIcon

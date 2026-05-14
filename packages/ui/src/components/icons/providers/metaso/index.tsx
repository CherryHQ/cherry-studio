import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MetasoAvatar } from './avatar'
import { MetasoDark } from './dark'
import { MetasoLight } from './light'

const Metaso = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MetasoLight className={cn('dark:hidden', className)} {...props} />
    <MetasoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MetasoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Metaso, {
  Light: MetasoLight,
  Dark: MetasoDark,
  Avatar: MetasoAvatar,
  colorPrimary: '#175CD3'
})

export default MetasoIcon

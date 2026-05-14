import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MinTop3Avatar } from './avatar'
import { MinTop3Dark } from './dark'
import { MinTop3Light } from './light'

const MinTop3 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MinTop3Light className={cn('dark:hidden', className)} {...props} />
    <MinTop3Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MinTop3Icon: CompoundIcon = /*#__PURE__*/ Object.assign(MinTop3, {
  Light: MinTop3Light,
  Dark: MinTop3Dark,
  Avatar: MinTop3Avatar,
  colorPrimary: '#FFF0A0'
})

export default MinTop3Icon

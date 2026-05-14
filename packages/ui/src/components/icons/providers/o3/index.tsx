import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { O3Avatar } from './avatar'
import { O3Dark } from './dark'
import { O3Light } from './light'

const O3 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <O3Light className={cn('dark:hidden', className)} {...props} />
    <O3Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const O3Icon: CompoundIcon = /*#__PURE__*/ Object.assign(O3, {
  Light: O3Light,
  Dark: O3Dark,
  Avatar: O3Avatar,
  colorPrimary: '#F5F6FC'
})

export default O3Icon

import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Ai21Avatar } from './avatar'
import { Ai21Dark } from './dark'
import { Ai21Light } from './light'

const Ai21 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Ai21Light className={cn('dark:hidden', className)} {...props} />
    <Ai21Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Ai21Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai21, {
  Light: Ai21Light,
  Dark: Ai21Dark,
  Avatar: Ai21Avatar,
  colorPrimary: '#000000'
})

export default Ai21Icon

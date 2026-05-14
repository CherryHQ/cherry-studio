import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Ai302Avatar } from './avatar'
import { Ai302Dark } from './dark'
import { Ai302Light } from './light'

const Ai302 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Ai302Light className={cn('dark:hidden', className)} {...props} />
    <Ai302Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Ai302Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai302, {
  Light: Ai302Light,
  Dark: Ai302Dark,
  Avatar: Ai302Avatar,
  colorPrimary: '#3F3FAA'
})

export default Ai302Icon

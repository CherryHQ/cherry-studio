import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt5Avatar } from './avatar'
import { Gpt5Dark } from './dark'
import { Gpt5Light } from './light'

const Gpt5 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt5Light className={cn('dark:hidden', className)} {...props} />
    <Gpt5Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt5Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5, {
  Light: Gpt5Light,
  Dark: Gpt5Dark,
  Avatar: Gpt5Avatar,
  colorPrimary: '#000000'
})

export default Gpt5Icon

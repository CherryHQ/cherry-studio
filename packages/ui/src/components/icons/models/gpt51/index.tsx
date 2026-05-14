import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt51Avatar } from './avatar'
import { Gpt51Dark } from './dark'
import { Gpt51Light } from './light'

const Gpt51 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt51Light className={cn('dark:hidden', className)} {...props} />
    <Gpt51Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt51Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51, {
  Light: Gpt51Light,
  Dark: Gpt51Dark,
  Avatar: Gpt51Avatar,
  colorPrimary: '#000000'
})

export default Gpt51Icon

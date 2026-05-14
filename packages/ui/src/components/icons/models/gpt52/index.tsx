import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt52Avatar } from './avatar'
import { Gpt52Dark } from './dark'
import { Gpt52Light } from './light'

const Gpt52 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt52Light className={cn('dark:hidden', className)} {...props} />
    <Gpt52Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt52Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52, {
  Light: Gpt52Light,
  Dark: Gpt52Dark,
  Avatar: Gpt52Avatar,
  colorPrimary: '#000000'
})

export default Gpt52Icon

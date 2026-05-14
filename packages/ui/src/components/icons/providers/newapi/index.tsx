import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NewapiAvatar } from './avatar'
import { NewapiDark } from './dark'
import { NewapiLight } from './light'

const Newapi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NewapiLight className={cn('dark:hidden', className)} {...props} />
    <NewapiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NewapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Newapi, {
  Light: NewapiLight,
  Dark: NewapiDark,
  Avatar: NewapiAvatar,
  colorPrimary: '#000000'
})

export default NewapiIcon

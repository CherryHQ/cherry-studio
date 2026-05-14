import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DmxapiAvatar } from './avatar'
import { DmxapiDark } from './dark'
import { DmxapiLight } from './light'

const Dmxapi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DmxapiLight className={cn('dark:hidden', className)} {...props} />
    <DmxapiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DmxapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dmxapi, {
  Light: DmxapiLight,
  Dark: DmxapiDark,
  Avatar: DmxapiAvatar,
  colorPrimary: '#924C88'
})

export default DmxapiIcon

import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { InceptionlabsAvatar } from './avatar'
import { InceptionlabsDark } from './dark'
import { InceptionlabsLight } from './light'

const Inceptionlabs = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <InceptionlabsLight className={cn('dark:hidden', className)} {...props} />
    <InceptionlabsDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const InceptionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inceptionlabs, {
  Light: InceptionlabsLight,
  Dark: InceptionlabsDark,
  Avatar: InceptionlabsAvatar,
  colorPrimary: '#000000'
})

export default InceptionlabsIcon

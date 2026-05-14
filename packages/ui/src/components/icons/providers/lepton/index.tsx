import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LeptonAvatar } from './avatar'
import { LeptonDark } from './dark'
import { LeptonLight } from './light'

const Lepton = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LeptonLight className={cn('dark:hidden', className)} {...props} />
    <LeptonDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LeptonIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lepton, {
  Light: LeptonLight,
  Dark: LeptonDark,
  Avatar: LeptonAvatar,
  colorPrimary: '#2D9CDB'
})

export default LeptonIcon

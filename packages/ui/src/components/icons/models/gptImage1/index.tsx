import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GptImage1Avatar } from './avatar'
import { GptImage1Dark } from './dark'
import { GptImage1Light } from './light'

const GptImage1 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GptImage1Light className={cn('dark:hidden', className)} {...props} />
    <GptImage1Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GptImage1Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage1, {
  Light: GptImage1Light,
  Dark: GptImage1Dark,
  Avatar: GptImage1Avatar,
  colorPrimary: '#000000'
})

export default GptImage1Icon

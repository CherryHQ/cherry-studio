import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GptImage15Avatar } from './avatar'
import { GptImage15Dark } from './dark'
import { GptImage15Light } from './light'

const GptImage15 = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GptImage15Light className={cn('dark:hidden', className)} {...props} />
    <GptImage15Dark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GptImage15Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage15, {
  Light: GptImage15Light,
  Dark: GptImage15Dark,
  Avatar: GptImage15Avatar,
  colorPrimary: '#000000'
})

export default GptImage15Icon

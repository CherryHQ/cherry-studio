import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TesseractJsAvatar } from './avatar'
import { TesseractJsDark } from './dark'
import { TesseractJsLight } from './light'

const TesseractJs = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TesseractJsLight className={cn('dark:hidden', className)} {...props} />
    <TesseractJsDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TesseractJsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TesseractJs, {
  Light: TesseractJsLight,
  Dark: TesseractJsDark,
  Avatar: TesseractJsAvatar,
  colorPrimary: '#FDFDFE'
})

export default TesseractJsIcon

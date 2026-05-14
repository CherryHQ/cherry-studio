import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TesseractJsAvatar } from './avatar'
import { TesseractJsDark } from './dark'
import { TesseractJsLight } from './light'

const TesseractJs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TesseractJsLight {...props} className={className} />
  if (variant === 'dark') return <TesseractJsDark {...props} className={className} />
  return (
    <>
      <TesseractJsLight className={cn('dark:hidden', className)} {...props} />
      <TesseractJsDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TesseractJsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TesseractJs, {
  Avatar: TesseractJsAvatar,
  colorPrimary: '#FDFDFE'
})

export default TesseractJsIcon

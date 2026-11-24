import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ModelrushAvatar } from './avatar'
import { ModelrushDark } from './dark'
import { ModelrushLight } from './light'

const Modelrush = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ModelrushLight {...props} className={className} />
  if (variant === 'dark') return <ModelrushDark {...props} className={className} />
  return (
    <>
      <ModelrushLight className={cn('dark:hidden', className)} {...props} />
      <ModelrushDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ModelrushIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Modelrush, {
  Avatar: ModelrushAvatar,
  colorPrimary: '#0B0F1A'
})

export default ModelrushIcon

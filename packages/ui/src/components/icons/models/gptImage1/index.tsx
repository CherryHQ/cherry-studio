import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage1Avatar } from './avatar'
import { GptImage1Dark } from './dark'
import { GptImage1Light } from './light'

const GptImage1 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage1Light {...props} className={className} />
  if (variant === 'dark') return <GptImage1Dark {...props} className={className} />
  return (
    <>
      <GptImage1Light className={cn('dark:hidden', className)} {...props} />
      <GptImage1Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GptImage1Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage1, {
  Avatar: GptImage1Avatar,
  colorPrimary: '#000000'
})

export default GptImage1Icon

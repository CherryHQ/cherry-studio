import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZhipuAvatar } from './avatar'
import { ZhipuDark } from './dark'
import { ZhipuLight } from './light'

const Zhipu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZhipuLight {...props} className={className} />
  if (variant === 'dark') return <ZhipuDark {...props} className={className} />
  return (
    <>
      <ZhipuLight className={cn(className, 'dark:hidden')} {...props} />
      <ZhipuDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const ZhipuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhipu, {
  Avatar: ZhipuAvatar,
  colorPrimary: '#3859FF'
})

export default ZhipuIcon

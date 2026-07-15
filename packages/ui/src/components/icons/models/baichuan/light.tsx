import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const BaichuanLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      style={{
        flex: 'none',
        lineHeight: 1
      }}
      viewBox="0 1 23 22"
      {...props}>
      <defs>
        <linearGradient id={`${iconId}-baichuanlight__a`} x1="17.764%" x2="100%" y1="8.678%" y2="91.322%">
          <stop offset="0%" stopColor="#FEC13E" />
          <stop offset="100%" stopColor="#FF6933" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${iconId}-baichuanlight__a)`}
        d="M7.333 2h-3.2l-2 4.333V17.8L0 22h5.2l2.028-4.2L7.333 2zm7.334 0h-5.2v20h5.2V2zM16.8 7.733H22V22h-5.2V7.733zM22 2h-5.2v4.133H22V2z"
      />
    </svg>
  )
}
export { BaichuanLight }
export default BaichuanLight

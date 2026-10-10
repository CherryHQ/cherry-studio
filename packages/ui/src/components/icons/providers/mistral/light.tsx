import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const MistralLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <mask
        id={`${iconId}-mistrallight__a`}
        width={65}
        height={65}
        x={27}
        y={28}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M92 28H27V93H92V28Z" />
      </mask>
      <g mask={`url(#${iconId}-mistrallight__a)`}>
        <path fill="#FA500F" d="M82.7104 65.1193H73.4236V74.3788H82.7104V65.1193Z" />
        <path fill="#E10500" d="M92.0008 74.3755H64.1438V83.6354H92.0008V74.3755Z" />
        <path
          fill="#FA500F"
          d="M64.1431 65.1193H54.8562V74.3788H64.1431V65.1193ZM45.5683 65.1193H36.2815V74.3788H45.5683V65.1193Z"
        />
        <path fill="#E10500" d="M54.8544 74.3755H27V83.6354H54.8544V74.3755Z" />
        <path
          fill="#FFAF00"
          d="M82.7143 46.6038H64.1438V55.8632H82.7143V46.6038ZM54.8521 46.6038H36.2815V55.8632H54.8521V46.6038Z"
        />
        <path fill="#FF8205" d="M82.7065 55.8591H36.2815V65.1186H82.7065V55.8591Z" />
        <path
          fill="#FFD800"
          d="M82.7104 37.3437H73.4236V46.6032H82.7104V37.3437ZM45.5683 37.3437H36.2815V46.6032H45.5683V37.3437Z"
        />
      </g>
    </svg>
  )
}
export { MistralLight }
export default MistralLight

import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const BaichuanLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <path fill="#FFF3E4" d="M0 0H120V120H0z" />
      <g transform="translate(-2.48 .124)scale(5.20661)">
        <path
          fill={`url(#${iconId}-baichuanlight__a)`}
          d="M9.33309 4H7.00582L5.55127 7.24975V15.85L4 19H7.78182L9.25673 15.85L9.33309 4ZM14.6669 4H10.8851V19H14.6669V4ZM16.2182 8.29975H20V19H16.2182V8.29975ZM20 4H16.2182V7.09975H20V4Z"
        />
        <defs>
          <linearGradient
            id={`${iconId}-baichuanlight__a`}
            x1={6.842}
            x2={19.148}
            y1={5.302}
            y2={18.493}
            gradientUnits="userSpaceOnUse">
            <stop stopColor="#FEC13E" />
            <stop offset={1} stopColor="#FF6933" />
          </linearGradient>
        </defs>
      </g>
    </svg>
  )
}
export { BaichuanLight }
export default BaichuanLight

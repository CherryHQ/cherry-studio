import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Baichuan: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
    <path
      fill="url(#baichuan__a)"
      fillRule="evenodd"
      d="M8.58154 1.7793H5.52779L3.34655 6.20409V17.7335L0.916016 22.2206H6.21333L8.58154 17.7335V1.7793ZM10.5761 1.7793H15.8111V22.2206H10.5761V1.7793ZM22.9166 1.7793H17.6816V6.01712H22.9166V1.7793ZM22.9166 7.38818H17.6816V22.2206H22.9166V7.38818Z"
      clipRule="evenodd"
    />
    <defs>
      <radialGradient
        id="baichuan__a"
        cx={0}
        cy={0}
        r={1}
        gradientTransform="matrix(14.5 14.5 -15.60613 15.60613 5.5 5.5)"
        gradientUnits="userSpaceOnUse">
        <stop stopColor="#FEBD3F" />
        <stop offset={0.776} stopColor="#FF6933" />
      </radialGradient>
    </defs>
  </svg>
)
export { Baichuan }
export default Baichuan

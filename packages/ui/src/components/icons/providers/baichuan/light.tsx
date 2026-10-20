import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const BaichuanLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <path
        fill={`url(#${iconId}-baichuanlight__a)`}
        d="M48.6657 30H39.2111L33.302 42.7824V76.61L27 89H42.3636L48.3554 76.61L48.6657 30ZM70.3343 30H54.9707V89H70.3343V30ZM76.6364 46.9124H92V89H76.6364V46.9124ZM92 30H76.6364V42.1923H92V30Z"
      />
      <defs>
        <linearGradient
          id={`${iconId}-baichuanlight__a`}
          x1={38.547}
          x2={86.816}
          y1={35.12}
          y2={88.562}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#FEC13E" />
          <stop offset={1} stopColor="#FF6933" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { BaichuanLight }
export default BaichuanLight

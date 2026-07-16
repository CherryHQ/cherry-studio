import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const PpioLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="9 9 102 102" {...props}>
      <mask
        id={`${iconId}-ppiolight__a`}
        width={65}
        height={65}
        x={28}
        y={28}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M93 28H28V93H93V28Z" />
      </mask>
      <g mask={`url(#${iconId}-ppiolight__a)`}>
        <mask
          id={`${iconId}-ppiolight__b`}
          width={65}
          height={65}
          x={28}
          y={28}
          maskUnits="userSpaceOnUse"
          style={{
            maskType: 'luminance'
          }}>
          <path fill="#fff" d="M93 28H28V93H93V28Z" />
        </mask>
        <g mask={`url(#${iconId}-ppiolight__b)`}>
          <path
            fill="#0062E2"
            d="M60.2712 28.2341C42.4569 28.2341 28 42.6709 28 60.4851C28 69.2661 31.5185 77.2408 37.2247 83.0577V60.5152C37.2247 54.3655 39.624 48.5585 43.9692 44.2133C48.3346 39.8481 54.1213 37.4688 60.2812 37.4688H60.4729L60.2712 37.489C73.0041 37.489 83.3278 47.8125 83.3278 60.5355C83.3278 61.6445 83.247 62.7333 83.0959 63.812L70.0704 50.7463C67.4693 48.1452 63.9813 46.7035 60.2915 46.7035C56.6013 46.7035 53.1233 48.1452 50.5122 50.7463C47.8909 53.3674 46.4594 56.8356 46.4594 60.5355C46.4594 64.2353 47.901 67.7036 50.5122 70.3247C53.1132 72.9258 56.6013 74.3675 60.2915 74.3675C63.9813 74.3675 67.4593 72.9258 70.0704 70.3247C72.5001 67.8951 73.9014 64.7193 74.0931 61.3217L81.735 68.9938C78.3577 77.543 70.0301 83.6021 60.2812 83.6021C55.2304 83.6021 50.4114 81.989 46.4493 78.9949V89.6612C50.6432 91.6572 55.3211 92.7666 60.2611 92.7666C78.0752 92.7666 92.5325 78.3295 92.5325 60.5152C92.552 42.681 78.1055 28.2442 60.2812 28.2442L60.2712 28.2341Z"
          />
        </g>
      </g>
    </svg>
  )
}
export { PpioLight }
export default PpioLight

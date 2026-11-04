import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const LiquidInferenceLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    aria-label="Liquid Inference"
    viewBox="0 0 128 128"
    {...props}
  >
    <defs>
      <clipPath id={`${iconId}-liquidinferencelight__a`}>
        <rect width={54} height={118} x={5} y={5} rx={27} />
      </clipPath>
    </defs>
    <rect width={72} height={128} x={28} fill="#fff" rx={36} />
    <g transform="translate(36 8)scale(.875)">
      <rect width={64} height={128} fill="#3c96dc" rx={32} />
      <g fill="#fff" clipPath={`url(#${iconId}-liquidinferencelight__a)`}>
        <circle cx={25} cy={17} r={8} />
        <circle cx={44} cy={43} r={12} />
        <path d="M5 108C13 106 23 106 26 99C29 92 26 86 20 85C11 84 6 79 6 72C6 63 12 57 20 57C29 57 35 63 35 72C35 79 32 84 35 90C39 98 51 97 59 104V128H5Z" />
      </g>
    </g>
  </svg>
  )
}
export { LiquidInferenceLight }
export default LiquidInferenceLight

import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const CohereLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <mask
        id={`${iconId}-coherelight__a`}
        width={65}
        height={65}
        x={27}
        y={27}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M92 27H27V92H92V27Z" />
      </mask>
      <g mask={`url(#${iconId}-coherelight__a)`}>
        <mask
          id={`${iconId}-coherelight__b`}
          width={65}
          height={65}
          x={27}
          y={27}
          maskUnits="userSpaceOnUse"
          style={{
            maskType: 'luminance'
          }}>
          <path fill="#fff" d="M92 27H27V92H92V27Z" />
        </mask>
        <g mask={`url(#${iconId}-coherelight__b)`}>
          <path
            fill="#39594D"
            fillRule="evenodd"
            d="M48.06 65.74C49.7933 65.74 53.26 65.6533 58.1133 63.66C63.7467 61.32 74.84 57.16 82.9 52.8267C88.5333 49.7933 90.96 45.8067 90.96 40.4333C90.96 33.0667 84.98 27 77.5267 27H46.3267C35.6667 27 27 35.6667 27 46.3267C27 56.9867 35.1467 65.74 48.06 65.74Z"
            clipRule="evenodd"
          />
          <path
            fill="#D18EE2"
            fillRule="evenodd"
            d="M53.3467 78.9999C53.3467 73.7999 56.4666 69.0333 61.3199 67.0399L71.1132 62.9666C81.0799 58.8933 92.0001 66.1733 92.0001 76.9199C92.0001 85.2399 85.2399 92 76.9199 92H66.2599C59.1532 92 53.3467 86.1933 53.3467 78.9999Z"
            clipRule="evenodd"
          />
          <path
            fill="#FF7759"
            d="M38.18 68.2531C32.0267 68.2531 27 73.2797 27 79.4331V80.9064C27 86.973 32.0267 92 38.18 92C44.3333 92 49.36 86.9731 49.36 80.8197V79.3464C49.2733 73.2797 44.3333 68.2531 38.18 68.2531Z"
          />
        </g>
      </g>
    </svg>
  )
}
export { CohereLight }
export default CohereLight

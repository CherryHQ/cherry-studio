import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const StepfunLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
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
      viewBox="0 0 24 24"
      {...props}>
      <path
        fill={`url(#${iconId}-stepfunlight__a)`}
        fillRule="evenodd"
        d="M22.012 0h1.032v.927H24v.968h-.956V3.78h-1.032V1.896h-1.878v-.97h1.878V0zM2.6 12.371V1.87h.969v10.502h-.97zm10.423.66h10.95v.918h-6.208v9.579h-4.742V13.03zM5.629 3.333v12.356H0v4.51h10.386V8L20.859 8l-.003-4.668-15.227.001z"
      />
      <defs>
        <linearGradient
          id={`${iconId}-stepfunlight__a`}
          x1={1.646}
          x2={18.342}
          y1={1.916}
          y2={22.091}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#01A9FF" />
          <stop offset={1} stopColor="#0160FF" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { StepfunLight }
export default StepfunLight

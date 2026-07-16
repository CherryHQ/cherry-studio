import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const OpenclawLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="9 9 102 102" {...props}>
      <path
        fill={`url(#${iconId}-openclawlight__a)`}
        d="M59.5001 32.5385C42.3573 32.5385 33.7859 46.8241 33.7859 58.2527C33.7859 69.6812 42.3573 81.1097 50.9287 83.9668V89.681H56.643V83.9668C56.643 83.9668 59.5001 85.1097 62.3572 83.9668V89.681H68.0715V83.9668C76.6428 81.1097 85.2142 69.6812 85.2142 58.2527C85.2142 46.8241 76.6428 32.5385 59.5001 32.5385Z"
      />
      <path
        fill={`url(#${iconId}-openclawlight__b)`}
        d="M36.6428 52.5384C28.0714 49.6813 25.2143 55.3955 28.0714 61.1098C30.9285 66.8241 36.6428 63.9669 39.4999 58.2527C41.2142 54.2527 39.4999 52.5384 36.6428 52.5384Z"
      />
      <path
        fill={`url(#${iconId}-openclawlight__c)`}
        d="M82.3572 52.5384C90.9286 49.6813 93.7857 55.3955 90.9286 61.1098C88.0715 66.8241 82.3572 63.9669 79.5001 58.2527C77.7858 54.2527 79.5001 52.5384 82.3572 52.5384Z"
      />
      <path
        stroke="#FF4D4D"
        strokeLinecap="round"
        strokeWidth={2.15}
        d="M50.9288 35.3956C47.1193 31.5861 44.2622 30.2528 42.3574 31.3956M68.0715 35.3956C71.8811 31.5861 74.7382 30.2528 76.6429 31.3956"
      />
      <path
        fill="#050810"
        d="M50.9288 50.2527C52.8223 50.2527 54.3574 48.7177 54.3574 46.8241 54.3574 44.9306 52.8223 43.3955 50.9288 43.3955 49.0353 43.3955 47.5002 44.9306 47.5002 46.8241 47.5002 48.7177 49.0353 50.2527 50.9288 50.2527ZM68.0716 50.2527C69.9651 50.2527 71.5002 48.7177 71.5002 46.8241 71.5002 44.9306 69.9651 43.3955 68.0716 43.3955 66.1781 43.3955 64.6431 44.9306 64.6431 46.8241 64.6431 48.7177 66.1781 50.2527 68.0716 50.2527Z"
      />
      <path
        fill="#00E5CC"
        d="M51.5001 47.6813C52.2891 47.6813 52.9286 47.0417 52.9286 46.2527 52.9286 45.4638 52.2891 44.8242 51.5001 44.8242 50.7112 44.8242 50.0715 45.4638 50.0715 46.2527 50.0715 47.0417 50.7112 47.6813 51.5001 47.6813ZM68.6427 47.6813C69.4317 47.6813 70.0712 47.0417 70.0712 46.2527 70.0712 45.4638 69.4317 44.8242 68.6427 44.8242 67.8537 44.8242 67.2141 45.4638 67.2141 46.2527 67.2141 47.0417 67.8537 47.6813 68.6427 47.6813Z"
      />
      <defs>
        <linearGradient
          id={`${iconId}-openclawlight__a`}
          x1={33.786}
          x2={90.613}
          y1={32.538}
          y2={83.683}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF4D4D" />
          <stop offset={1} stopColor="#991B1B" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-openclawlight__b`}
          x1={27}
          x2={39.425}
          y1={51.778}
          y2={64.941}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF4D4D" />
          <stop offset={1} stopColor="#991B1B" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-openclawlight__c`}
          x1={78.816}
          x2={91.242}
          y1={51.778}
          y2={64.941}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF4D4D" />
          <stop offset={1} stopColor="#991B1B" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { OpenclawLight }
export default OpenclawLight

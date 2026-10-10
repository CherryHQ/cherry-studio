import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'

const TokendosLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 300 300" {...props}>
      <defs>
        <radialGradient id={`${iconId}-bg`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#0f1f5c" />
          <stop offset="100%" stopColor="#0a0e27" />
        </radialGradient>
        <linearGradient id={`${iconId}-g1`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e40af" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id={`${iconId}-g2`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <clipPath id={`${iconId}-c1`}>
          <polygon points="170.0,132.0 141.0,182.2 83.0,182.2 54.0,132.0 83.0,81.8 141.0,81.8" />
        </clipPath>
        <clipPath id={`${iconId}-c2`}>
          <polygon points="246.0,132.0 217.0,182.2 159.0,182.2 130.0,132.0 159.0,81.8 217.0,81.8" />
        </clipPath>
        <clipPath id={`${iconId}-cc`}>
          <circle cx="150" cy="150" r="145" />
        </clipPath>
      </defs>
      <circle cx="150" cy="150" r="148" fill={`url(#${iconId}-bg)`} stroke="#22d3ee" strokeWidth="2" opacity="0.7" />
      <g clipPath={`url(#${iconId}-cc)`}>
        <polygon points="170.0,132.0 141.0,182.2 83.0,182.2 54.0,132.0 83.0,81.8 141.0,81.8" fill={`url(#${iconId}-g1)`} />
        <polygon points="246.0,132.0 217.0,182.2 159.0,182.2 130.0,132.0 159.0,81.8 217.0,81.8" fill={`url(#${iconId}-g2)`} />
        <polygon points="170.0,132.0 141.0,182.2 83.0,182.2 54.0,132.0 83.0,81.8 141.0,81.8" fill="none" stroke="#3b82f6" strokeWidth="2" opacity="0.6" />
        <polygon points="246.0,132.0 217.0,182.2 159.0,182.2 130.0,132.0 159.0,81.8 217.0,81.8" fill="none" stroke="#22d3ee" strokeWidth="2" opacity="0.6" />
        <g clipPath={`url(#${iconId}-c1)`}>
          <text x="112" y="132" textAnchor="middle" dominantBaseline="central" fontFamily="Arial,Helvetica,sans-serif" fontWeight="900" fontSize="87" fill="#ffffff">T</text>
        </g>
        <g clipPath={`url(#${iconId}-c2)`}>
          <text x="188" y="132" textAnchor="middle" dominantBaseline="central" fontFamily="Arial,Helvetica,sans-serif" fontWeight="900" fontSize="87" fill="#ffffff">D</text>
        </g>
        <text x="150" y="232" textAnchor="middle" dominantBaseline="central" fontFamily="Arial,Helvetica,sans-serif" fontWeight="700" fontSize="36" fill="#ffffff">
          Token<tspan fill="#22d3ee">Dos</tspan>
        </text>
      </g>
    </svg>
  )
}

export { TokendosLight }
export default TokendosLight

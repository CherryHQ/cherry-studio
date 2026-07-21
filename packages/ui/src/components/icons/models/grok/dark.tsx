import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const GrokDark: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
      <mask
        id={`${iconId}-grokdark__a`}
        width={16}
        height={16}
        x={4}
        y={4}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M20 4H4V20H20V4Z" />
      </mask>
      <g mask={`url(#${iconId}-grokdark__a)`}>
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M10.18 14.1933L15.4987 10.262C15.7593 10.0687 16.132 10.144 16.2567 10.4433C16.91 12.0227 16.618 13.92 15.3167 15.2227C14.016 16.5253 12.2053 16.8107 10.5507 16.16L8.74333 16.998C11.336 18.772 14.484 18.3333 16.4513 16.3627C18.012 14.8 18.4953 12.67 18.0433 10.7493L18.0473 10.754C17.392 7.93266 18.2087 6.80466 19.8807 4.49866C19.9207 4.44399 19.9607 4.38933 20 4.33333L17.7993 6.53666V6.53L10.178 14.1947M9.082 15.1487C7.22067 13.3687 7.542 10.6147 9.12933 9.026C10.3033 7.85066 12.2273 7.37066 13.9067 8.07599L15.71 7.24266C15.3352 6.96694 14.9251 6.74272 14.4907 6.576C13.3985 6.129 12.1986 6.01493 11.0418 6.24814C9.88499 6.48134 8.82297 7.05142 7.98933 7.88666C6.30067 9.57733 5.76933 12.1773 6.68133 14.396C7.36267 16.054 6.246 17.2267 5.12133 18.4107C4.722 18.8307 4.322 19.25 4 19.694L9.08 15.1507"
          clipRule="evenodd"
        />
      </g>
    </svg>
  )
}
export { GrokDark }
export default GrokDark

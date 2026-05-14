import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AnthropicLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#anthropiclight__a)">
      <mask
        id="anthropiclight__b"
        width={83}
        height={83}
        x={19}
        y={18}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M102 18H19V101H102V18Z" />
      </mask>
      <g mask="url(#anthropiclight__b)">
        <path
          fill="#CA9F7B"
          d="M81.25 18H39.75C28.2901 18 19 27.2901 19 38.75V80.25C19 91.7099 28.2901 101 39.75 101H81.25C92.7099 101 102 91.7099 102 80.25V38.75C102 27.2901 92.7099 18 81.25 18Z"
        />
        <path
          fill="#191918"
          d="M72.2027 40.2539H63.8488L79.0834 78.7465H87.4377L72.2027 40.2539ZM48.0668 40.2539L32.832 78.7465H41.3509L44.4665 70.6633H60.405L63.5202 78.7465H72.0392L56.8045 40.2539H48.0668ZM47.2223 63.5143L52.4357 49.9866L57.649 63.5143H47.2223Z"
        />
      </g>
    </g>
    <defs>
      <clipPath id="anthropiclight__a">
        <path fill="#fff" d="M0 0H83V83H0z" transform="translate(19 18)" />
      </clipPath>
    </defs>
  </svg>
)
export { AnthropicLight }
export default AnthropicLight

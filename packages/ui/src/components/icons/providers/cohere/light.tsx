import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const CohereLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g clipPath="url(#coherelight__a)">
      <mask
        id="coherelight__b"
        width={84}
        height={84}
        x={18}
        y={18}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M101.5 18.5H18.5V101.5H101.5V18.5Z" />
      </mask>
      <g mask="url(#coherelight__b)">
        <path
          fill="#39594D"
          fillRule="evenodd"
          d="M45.392 67.968C47.6053 67.968 52.032 67.8573 58.2293 65.312C65.4227 62.324 79.588 57.012 89.88 51.4787C97.0733 47.6053 100.172 42.5147 100.172 35.6533C100.172 26.2467 92.536 18.5 83.0187 18.5H43.1787C29.5667 18.5 18.5 29.5667 18.5 43.1787C18.5 56.7907 28.9027 67.968 45.392 67.968Z"
          clipRule="evenodd"
        />
        <path
          fill="#D18EE2"
          fillRule="evenodd"
          d="M52.1426 84.8999C52.1426 78.2599 56.1265 72.1733 62.3238 69.6279L74.8291 64.4266C87.5558 59.2253 101.5 68.5213 101.5 82.2439C101.5 92.8679 92.8678 101.5 82.2438 101.5H68.6318C59.5571 101.5 52.1426 94.0853 52.1426 84.8999Z"
          clipRule="evenodd"
        />
        <path
          fill="#FF7759"
          d="M32.776 71.177C24.9187 71.177 18.5 77.5957 18.5 85.453V87.3343C18.5 95.081 24.9187 101.5 32.776 101.5C40.6333 101.5 47.052 95.081 47.052 87.2237V85.3423C46.9413 77.5957 40.6333 71.177 32.776 71.177Z"
        />
      </g>
    </g>
    <defs>
      <clipPath id="coherelight__a">
        <path fill="#fff" d="M0 0H83V83H0z" transform="translate(18.5 18.5)" />
      </clipPath>
    </defs>
  </svg>
)
export { CohereLight }
export default CohereLight

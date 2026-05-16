import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AiStudioLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="29.781 18.609 67.313 68.172"
    {...props}>
    <g clipPath="url(#aistudiolight__a)">
      <mask
        id="aistudiolight__b"
        width={110}
        height={110}
        x={5}
        y={5}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M115 5H5V115H115V5Z" />
        <path
          fill="#000"
          d="M75.8984 66.2305C88.9505 66.2305 99.5312 55.6497 99.5312 42.5977C99.5312 29.5456 88.9505 18.9648 75.8984 18.9648C62.8464 18.9648 52.2656 29.5456 52.2656 42.5977C52.2656 55.6497 62.8464 66.2305 75.8984 66.2305Z"
        />
      </mask>
      <g mask="url(#aistudiolight__b)">
        <path
          stroke="#1A1A1A"
          strokeLinejoin="round"
          strokeWidth={6.016}
          d="M80.625 30.7812H35.9375C33.0898 30.7812 30.7812 33.0898 30.7812 35.9375V80.625C30.7812 83.4727 33.0898 85.7812 35.9375 85.7812H80.625C83.4727 85.7812 85.7812 83.4727 85.7812 80.625V35.9375C85.7812 33.0898 83.4727 30.7812 80.625 30.7812Z"
        />
      </g>
      <path
        fill="#1A1A1A"
        d="M75.8984 19.6094C75.8984 19.6094 73.3203 30.3516 69.8828 33.7891C66.4453 37.2266 55.7031 39.8047 55.7031 39.8047C55.7031 39.8047 66.4453 42.3828 69.8828 45.8203C73.3203 49.2578 75.8984 60 75.8984 60C75.8984 60 78.4766 49.2578 81.9141 45.8203C85.3516 42.3828 96.0938 39.8047 96.0938 39.8047C96.0938 39.8047 85.3516 37.2266 81.9141 33.7891C78.4766 30.3516 75.8984 19.6094 75.8984 19.6094Z"
      />
    </g>
    <defs>
      <clipPath id="aistudiolight__a">
        <path fill="#fff" d="M0 0H110V110H0z" transform="translate(5 5)" />
      </clipPath>
    </defs>
  </svg>
)
export { AiStudioLight }
export default AiStudioLight

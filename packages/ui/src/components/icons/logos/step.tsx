import type { SVGProps } from 'react'
const Step = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <g clipPath="url(#step__clip0_1008_212032)">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.012 0H23.044V0.927H24V1.895H23.044V3.78H22.012V1.896H20.134V0.926H22.012V0ZM2.6 12.371V1.87H3.569V12.372H2.599L2.6 12.371ZM13.023 13.031H23.973V13.949H17.765V23.528H13.023V13.03V13.031ZM5.629 3.333V15.689H0V20.199H10.386V8H20.859L20.856 3.332L5.629 3.333Z"
        fill="url(#step__paint0_linear_1008_212032)"
      />
    </g>
    <defs>
      <linearGradient
        id="step__paint0_linear_1008_212032"
        x1={1.646}
        y1={1.916}
        x2={18.342}
        y2={22.091}
        gradientUnits="userSpaceOnUse">
        <stop stopColor="#01A9FF" />
        <stop offset={1} stopColor="#0160FF" />
      </linearGradient>
      <clipPath id="step__clip0_1008_212032">
        <rect width={24} height={24} fill="white" />
      </clipPath>
    </defs>
  </svg>
)
export { Step }
export default Step

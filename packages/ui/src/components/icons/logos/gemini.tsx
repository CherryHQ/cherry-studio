import type { SVGProps } from 'react'
const Gemini = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <g clipPath="url(#gemini__clip0_1004_325515)">
      <path
        d="M18 0H6C2.68629 0 0 2.68629 0 6V18C0 21.3137 2.68629 24 6 24H18C21.3137 24 24 21.3137 24 18V6C24 2.68629 21.3137 0 18 0Z"
        fill="url(#gemini__paint0_linear_1004_325515)"
      />
      <path
        d="M20 12.0116C15.7043 12.42 12.3692 15.757 11.9995 20C11.652 15.8183 8.20301 12.361 4 12.0181C8.21855 11.6991 11.6656 8.1853 12.006 4C12.2833 8.19653 15.8057 11.7005 20 12.0116Z"
        fill="white"
        fillOpacity={0.88}
      />
    </g>
    <defs>
      <linearGradient
        id="gemini__paint0_linear_1004_325515"
        x1={-9}
        y1={29.5}
        x2={19.4387}
        y2={1.43791}
        gradientUnits="userSpaceOnUse">
        <stop offset={0.192878} stopColor="#1C7DFF" />
        <stop offset={0.520213} stopColor="#1C69FF" />
        <stop offset={1} stopColor="#F0DCD6" />
      </linearGradient>
      <clipPath id="gemini__clip0_1004_325515">
        <rect width={24} height={24} fill="white" />
      </clipPath>
    </defs>
  </svg>
)
export { Gemini }
export default Gemini

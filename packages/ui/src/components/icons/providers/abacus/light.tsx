import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AbacusLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="#000" d="M0 0H120V120H0z" />
    <rect width={4.511} height={11.688} x={33.461} y={73.546} fill="#D1E4F5" rx={2.256} />
    <rect width={4.511} height={13.738} x={81.237} y={36.227} fill="#D1E4F5" rx={2.256} />
    <rect width={4.511} height={31.987} x={65.243} y={27} fill="#fff" rx={2.256} />
    <rect width={4.511} height={19.274} x={33.461} y={36.227} fill="#fff" rx={2.256} />
    <rect width={4.511} height={15.994} x={81.237} y={68.01} fill="#fff" rx={2.256} />
    <rect width={4.511} height={31.987} x={49.454} y={60.013} fill="#fff" rx={2.256} />
    <rect width={4.511} height={13.533} x={65.243} y={78.467} fill="#D1E4F5" rx={2.256} />
    <rect width={4.511} height={13.943} x={49.454} y={28.025} fill="#D1E4F5" rx={2.256} />
    <circle cx={35.716} cy={64.729} r={4.716} fill="#238BFE" />
    <circle cx={51.607} cy={50.478} r={4.614} fill="#D930A5" />
    <circle cx={67.601} cy={69.137} r={4.614} fill="#25E3E1" />
    <circle cx={83.492} cy={58.987} r={4.511} fill="#B636FB" />
  </svg>
)
export { AbacusLight }
export default AbacusLight

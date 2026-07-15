import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const LiquidLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="1 0 21.286 24"
    {...props}>
    <path d="M12.028 8.546l-.008.005 3.03 5.25a3.94 3.94 0 01.643 2.162c0 .754-.212 1.46-.58 2.062l6.173-1.991L11.63 0 9.304 3.872l2.724 4.674zM6.837 24l4.85-4.053h-.013c-2.219 0-4.017-1.784-4.017-3.984 0-.794.235-1.534.64-2.156l2.865-4.976-2.381-4.087L2 16.034 6.83 24h.007zM13.737 19.382h-.001L8.222 24h8.182l4.148-6.769-6.815 2.151z" />
  </svg>
)
export { LiquidLight }
export default LiquidLight

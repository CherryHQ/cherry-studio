import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const MicrosoftLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="1 1 22 22"
    {...props}>
    <path fill="#F25022" d="M11.49 2H2v9.492h9.492V2h-.002z" />
    <path fill="#7FBA00" d="M22 2h-9.492v9.492H22V2z" />
    <path fill="#00A4EF" d="M11.49 12.508H2V22h9.492v-9.492h-.002z" />
    <path fill="#FFB900" d="M22 12.508h-9.492V22H22v-9.492z" />
  </svg>
)
export { MicrosoftLight }
export default MicrosoftLight

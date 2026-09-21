import { type SVGProps } from 'react'

import type { IconComponent } from '../../types'

const GitGotLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
    <g fill="none" stroke="#2e6f40" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}>
      <path d="M12 2 2 7l10 5 10-5z" />
      <path d="m2 12 10 5 10-5" opacity={0.75} />
      <path d="m2 17 10 5 10-5" opacity={0.5} />
    </g>
  </svg>
)

export { GitGotLight }
export default GitGotLight

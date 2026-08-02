import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

// Placeholder monogram — replace with the official AvalAI logo before release.
const AvalaiLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <rect width={120} height={120} fill="#fff" rx={24} />
    <path
      fill="#0E9384"
      fillRule="evenodd"
      d="M60 26 92 94H78.6l-6.4-14.4H47.8L41.4 94H28L60 26Zm0 24.4L52.6 68h14.8L60 50.4Z"
      clipRule="evenodd"
    />
  </svg>
)

export { AvalaiLight }
export default AvalaiLight

import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const SkyworkLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-skyworklight__a)`}>
        <path
          fill="#4D5EFF"
          d="M6.71712 0.878258C5.94548 0.27694 4.98653 -0.0330542 4.00892 0.0027946C3.03131 0.0386434 2.09764 0.418039 1.37212 1.07426C0.553015 1.81504 0.061441 2.85066 0.00537828 3.95364C-0.0506845 5.05661 0.333348 6.13674 1.07312 6.95676C1.72831 7.68335 2.6187 8.15566 3.58771 8.29064C4.55672 8.42562 5.5423 8.21463 6.37112 7.69476L3.13962 4.11326L6.71712 0.878258Z"
        />
        <path
          fill="#00FFCE"
          d="M5.2846 10.8713C6.05616 11.4723 7.0149 11.7822 7.99229 11.7463C8.96967 11.7105 9.90314 11.3312 10.6286 10.6753C11.4476 9.9344 11.9391 8.8988 11.9951 7.79587C12.0512 6.69294 11.6672 5.61284 10.9276 4.79276C10.2724 4.06617 9.38202 3.59386 8.41301 3.45887C7.44399 3.32389 6.45842 3.53489 5.6296 4.05476L8.8611 7.63626L5.2836 10.8713H5.2846Z"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-skyworklight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { SkyworkLight }
export default SkyworkLight

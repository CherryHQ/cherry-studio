import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const RADEON_CLOUD_LOGO_URL = 'https://amd-ai-academy.com/static/image.png'

const RadeonCloudLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <rect width={120} height={120} fill="#fff" rx={24} />
    <image href={RADEON_CLOUD_LOGO_URL} x={14} y={49} width={92} height={22} preserveAspectRatio="xMidYMid meet" />
  </svg>
)

export { RadeonCloudLight }
export default RadeonCloudLight

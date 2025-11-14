/**
 * @deprecated 此组件使用频率为 0 次，不符合 UI 库提取标准（需 ≥3 次）
 * 计划在未来版本中移除。虽然主项目中有本地副本，但完全未被导入使用。
 *
 * This component has 0 usages and does not meet the UI library extraction criteria (requires ≥3 usages).
 * Planned for removal in future versions.
 */

// Original path: src/renderer/src/components/Icons/SvgSpinners180Ring.tsx
import type { SVGProps } from 'react'

import { cn } from '../../../utils'

interface SvgSpinners180RingProps extends SVGProps<SVGSVGElement> {
  size?: number | string
}

export function SvgSpinners180Ring(props: SvgSpinners180RingProps) {
  const { size = '1em', className, ...svgProps } = props

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...svgProps}
      className={cn('animate-spin', className)}>
      {/* Icon from SVG Spinners by Utkarsh Verma - https://github.com/n3r4zzurr0/svg-spinners/blob/main/LICENSE */}
      <path
        fill="currentColor"
        d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z"></path>
    </svg>
  )
}

export default SvgSpinners180Ring

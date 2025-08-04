import { SVGProps } from 'react'

export function SvgSpinners180Ring(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  const { size = '1em', ...svgProps } = props
  // 避免与全局样式冲突
  const animationClassName = 'svg-spinner-anim-180-ring'

  return (
    <>
      {/*  CSS transform 硬件加速 */}
      <style>
        {`
          @keyframes svg-spinner-rotate-180-ring {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
          .${animationClassName} {
            transform-origin: center;
            animation: svg-spinner-rotate-180-ring 0.75s linear infinite;
          }
        `}
      </style>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        {...svgProps}
        className={`${animationClassName} ${svgProps.className || ''}`.trim()}>
        {/* Icon from SVG Spinners by Utkarsh Verma - https://github.com/n3r4zzurr0/svg-spinners/blob/main/LICENSE */}
        <path
          fill="currentColor"
          d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z"></path>
      </svg>
    </>
  )
}
export default SvgSpinners180Ring

import { CSSProperties, SVGProps } from 'react'

interface BaseFileIconProps extends SVGProps<SVGSVGElement> {
  size?: string
  text?: string
}

const textStyle: CSSProperties = {
  fontStyle: 'italic',
  fontSize: '7.70985px',
  lineHeight: 0.8,
  fontFamily: "'Times New Roman'",
  textAlign: 'center',
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  textAnchor: 'middle',
  fill: 'none',
  stroke: '#000000',
  strokeWidth: '0.289119',
  strokeLinejoin: 'round',
  strokeDasharray: 'none'
}

const tspanStyle: CSSProperties = {
  fontStyle: 'normal',
  fontVariant: 'normal',
  fontWeight: 'normal',
  fontStretch: 'condensed',
  fontSize: '7.70985px',
  lineHeight: 0.8,
  fontFamily: 'Arial',
  fill: '#000000',
  fillOpacity: 1,
  strokeWidth: '0.289119',
  strokeDasharray: 'none'
}

const BaseFileIcon = ({ size = '1.1em', text = 'SVG', ...props }: BaseFileIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    version="1.1"
    id="svg4"
    xmlns="http://www.w3.org/2000/svg"
    {...props}>
    <defs id="defs4" />
    <path d="m 14,2 v 4 a 2,2 0 0 0 2,2 h 4" id="path3" />
    <path d="M 15,2 H 6 A 2,2 0 0 0 4,4 v 16 a 2,2 0 0 0 2,2 h 12 a 2,2 0 0 0 2,-2 V 7 Z" id="path4" />
    <text
      xmlSpace="preserve"
      style={textStyle}
      x="12.478625"
      y="17.170216"
      id="text4"
      transform="scale(0.96196394,1.03954)">
      <tspan id="tspan4" x="12.478625" y="17.170216" style={tspanStyle}>
        {text}
      </tspan>
    </text>
  </svg>
)

export const FileSvgIcon = (props: Omit<BaseFileIconProps, 'text'>) => <BaseFileIcon text="SVG" {...props} />
export const FilePngIcon = (props: Omit<BaseFileIconProps, 'text'>) => <BaseFileIcon text="PNG" {...props} />

import { SVGProps } from 'react'

// 基础下载图标
export const DownloadIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1.1em"
    height="1.1em"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M12 15V3" />
    <polygon points="12,15 9,11 15,11" fill="currentColor" stroke="none" />
  </svg>
)

// 带有文件类型的下载图标基础组件
const DownloadTypeIconBase = ({ type, ...props }: SVGProps<SVGSVGElement> & { type: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1.1em"
    height="1.1em"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}>
    <text
      x="12"
      y="7"
      fontSize="8"
      textAnchor="middle"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0.3"
      letterSpacing="1"
      fontFamily="Arial Black, sans-serif"
      style={{
        paintOrder: 'stroke',
        fontStretch: 'expanded',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none'
      }}>
      {type}
    </text>
    <path d="M21 16v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3" />
    <path d="M12 17V10" />
    <polygon points="12,17 9.5,14 14.5,14" fill="currentColor" stroke="none" />
  </svg>
)

// JPG 文件下载图标
export const DownloadJpgIcon = (props: SVGProps<SVGSVGElement>) => <DownloadTypeIconBase type="JPG" {...props} />

// PNG 文件下载图标
export const DownloadPngIcon = (props: SVGProps<SVGSVGElement>) => <DownloadTypeIconBase type="PNG" {...props} />

// SVG 文件下载图标
export const DownloadSvgIcon = (props: SVGProps<SVGSVGElement>) => <DownloadTypeIconBase type="SVG" {...props} />

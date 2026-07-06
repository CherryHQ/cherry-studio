import React from 'react'

const WrapIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    className="wrap_svg__lucide wrap_svg__lucide-wrap-text wrap_svg__size-4"
    viewBox="0 0 24 24"
    {...props}>
    <path d="M3 6h18M3 12h15a3 3 0 1 1 0 6h-4" />
    <path d="m16 16-2 2 2 2M3 18h7" />
  </svg>
)
export default WrapIcon

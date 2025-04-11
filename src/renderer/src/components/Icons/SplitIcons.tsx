import { SVGProps } from 'react'

export const SplitHorizontalIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1.1em"
    height="1.1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
  </svg>
)

export const SplitVerticalIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1.1em"
    height="1.1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 12h18" />
  </svg>
)

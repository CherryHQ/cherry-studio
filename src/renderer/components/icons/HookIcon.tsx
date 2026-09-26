import type { SVGProps } from 'react'

export function HookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide lucide-custom"
      aria-hidden="true"
      {...props}>
      <circle cx={9} cy={4} r={2} />
      <path d="M9 6v10a5 5 0 0 0 10 0v-3l-3 3" />
    </svg>
  )
}

import type { SVGProps } from 'react'

type BracesVariableIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

export function BracesVariableIcon({ size = '1em', ...props }: BracesVariableIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      {...props}>
      {/* Fluent UI System Icons by Microsoft, MIT License:
          https://github.com/microsoft/fluentui-system-icons */}
      <path
        fill="currentColor"
        d="M3.5 5.75A2.75 2.75 0 0 1 6.25 3a.75.75 0 0 1 0 1.5C5.56 4.5 5 5.06 5 5.75v4.309c0 .744-.3 1.437-.802 1.941A2.75 2.75 0 0 1 5 13.941v4.309c0 .69.56 1.25 1.25 1.25a.75.75 0 0 1 0 1.5a2.75 2.75 0 0 1-2.75-2.75v-4.308a1.25 1.25 0 0 0-.855-1.186l-.132-.045a.75.75 0 0 1 0-1.422l.132-.045c.51-.17.855-.647.855-1.185zm17 0A2.75 2.75 0 0 0 17.75 3a.75.75 0 0 0 0 1.5c.69 0 1.25.56 1.25 1.25v4.309c0 .744.3 1.437.802 1.941A2.75 2.75 0 0 0 19 13.941v4.309c0 .69-.56 1.25-1.25 1.25a.75.75 0 0 0 0 1.5a2.75 2.75 0 0 0 2.75-2.75v-4.308c0-.539.344-1.016.855-1.186l.132-.045a.75.75 0 0 0 0-1.422l-.132-.045a1.25 1.25 0 0 1-.855-1.185zM9.092 7.04a.75.75 0 1 0-1.184.92L11.05 12l-3.142 4.04a.75.75 0 0 0 1.184.92L12 13.223l2.908 3.739a.75.75 0 0 0 1.184-.921L12.95 12l3.142-4.04a.75.75 0 0 0-1.184-.92L12 10.778z"
      />
    </svg>
  )
}

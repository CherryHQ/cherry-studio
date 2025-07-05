import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'

type Props = {
  content: string
}

export default function InfoTooltip({ content }: Props) {
  return (
    <Tooltip title={content}>
      <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
    </Tooltip>
  )
}

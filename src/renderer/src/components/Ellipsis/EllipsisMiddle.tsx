import { Typography } from 'antd'
import { CSSProperties } from 'react'

const { Text } = Typography

export const EllipsisMiddle: React.FC<{ suffixCount: number; children: string; style: CSSProperties }> = ({
  suffixCount,
  children,
  style
}) => {
  const start = children.slice(0, children.length - suffixCount)
  const suffix = children.slice(-suffixCount).trim()
  return (
    <Text style={{ maxWidth: '100%', ...style }} ellipsis={{ suffix }}>
      {start}
    </Text>
  )
}

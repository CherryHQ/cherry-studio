import { Handle, Position } from '@xyflow/react'
import { Card, Typography } from 'antd'
import styled from 'styled-components'

interface CenterNodeProps {
  data: {
    label: string
  }
}

const CenterNode: React.FC<CenterNodeProps> = ({ data }) => {
  return (
    <NodeContainer>
      <Card>
        <Typography.Title level={4}>{data.label}</Typography.Title>
      </Card>
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Top} id="t" />
    </NodeContainer>
  )
}

const NodeContainer = styled.div`
  width: 150px;
  text-align: center;
`

export default CenterNode

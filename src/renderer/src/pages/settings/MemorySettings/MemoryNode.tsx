import { DeleteOutlined, EditOutlined, TagOutlined } from '@ant-design/icons'
import { Memory } from '@renderer/store/memory'
import { Handle, Position } from '@xyflow/react'
import { Button, Card, Tag, Tooltip, Typography } from 'antd'
import styled from 'styled-components'

interface MemoryNodeProps {
  data: {
    memory: Memory
    onEdit: (id: string) => void
    onDelete: (id: string) => void
  }
}

const MemoryNode: React.FC<MemoryNodeProps> = ({ data }) => {
  const { memory, onEdit, onDelete } = data

  return (
    <NodeContainer>
      <Handle type="target" position={Position.Top} />
      <Card
        size="small"
        title={
          <div>
            {memory.category && (
              <Tag color="blue" icon={<TagOutlined />} style={{ marginBottom: 4 }}>
                {memory.category}
              </Tag>
            )}
            <Typography.Text ellipsis style={{ width: 180, display: 'block' }}>
              {memory.content}
            </Typography.Text>
          </div>
        }
        extra={
          <div>
            <Tooltip title="编辑">
              <Button icon={<EditOutlined />} type="text" size="small" onClick={() => onEdit(memory.id)} />
            </Tooltip>
            <Tooltip title="删除">
              <Button icon={<DeleteOutlined />} type="text" danger size="small" onClick={() => onDelete(memory.id)} />
            </Tooltip>
          </div>
        }>
        <MemoryMeta>
          <span>{new Date(memory.createdAt).toLocaleString()}</span>
          {memory.source && <span>{memory.source}</span>}
        </MemoryMeta>
      </Card>
    </NodeContainer>
  )
}

const NodeContainer = styled.div`
  width: 220px;
`

const MemoryMeta = styled.div`
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--color-text-secondary);
`

export default MemoryNode

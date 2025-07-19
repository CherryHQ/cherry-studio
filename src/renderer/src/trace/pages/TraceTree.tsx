import { TraceModal } from '@renderer/trace/pages/TraceModel'
import { Divider } from 'antd/lib'
import * as React from 'react'
import { useEffect, useState } from 'react'

import { Box, GridItem, HStack, IconButton, SimpleGrid, Text } from './Component'
import { ProgressBar } from './ProgressBar'

interface TreeNodeProps {
  node: TraceModal
  handleClick: (nodeId: string) => void
  treeData?: TraceModal[]
  paddingLeft?: number
}

export const convertTime = (time: number | null): string => {
  if (time == null) {
    return ''
  }
  if (time > 100000) {
    return `${(time / 1000).toFixed(0)}s`
  }
  if (time > 10000) {
    return `${(time / 1000).toFixed(1)}s`
  }
  if (time > 1000) {
    return `${(time / 1000).toFixed(2)}s`
  }
  if (time > 100) {
    return `${time.toFixed(0)}ms`
  }
  if (time > 10) {
    return `${time.toFixed(1)}ms`
  }
  return time.toFixed(2) + 'ms'
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, handleClick, treeData, paddingLeft = 2 }) => {
  const [isOpen, setIsOpen] = useState(true)
  const hasChildren = node.children && node.children.length > 0
  const [usedTime, setUsedTime] = useState('--')

  // 只在 endTime 或 node 变化时更新 usedTime
  useEffect(() => {
    const endTime = node.endTime || Date.now()
    setUsedTime(convertTime(endTime - node.startTime))
  }, [node])

  return (
    <div
      style={{
        width: '100%'
      }}>
      <SimpleGrid
        columns={20}
        className="traceItem"
        onClick={(e) => {
          e.preventDefault()
          handleClick(node.id)
        }}>
        <GridItem colSpan={8} style={{ paddingLeft: `${paddingLeft}px`, textAlign: 'left' }}>
          <HStack grap={2}>
            <IconButton
              aria-label="Toggle"
              aria-expanded={isOpen ? true : false}
              size="sm"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setIsOpen(!isOpen)
              }}
              fontSize="10px"
              style={{
                margin: '0px',
                visibility: hasChildren ? 'visible' : 'hidden'
              }}
            />
            <Text role="button" tabIndex={0} className={node.status === 'ERROR' ? 'error-text' : 'default-text'}>
              {node.name}
            </Text>
          </HStack>
        </GridItem>
        {/* <GridItem padding={4} colSpan={3}>
          <Text
            // ml={2}
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
            {node.attributes?.tags}
          </Text>
        </GridItem> */}
        <GridItem colSpan={5}>
          <Text style={{ color: 'red' }}>{node.usage ? '↑' + node.usage.prompt_tokens : ''}</Text>&nbsp;
          <Text style={{ color: 'green' }}>{node.usage ? '↓' + node.usage.completion_tokens : ''}</Text>
        </GridItem>
        <GridItem colSpan={3}>
          <Text /** ml={2} */>{usedTime}</Text>
        </GridItem>
        <GridItem padding={2} colSpan={4}>
          <ProgressBar progress={Math.max(node.percent, 5)} start={node.start} />
        </GridItem>
      </SimpleGrid>
      <Divider
        orientation="end"
        style={{
          borderTop: '1px solid #ccc',
          width: '100%',
          margin: '0px 5px 0px 0px'
        }}
      />
      {hasChildren && isOpen && (
        <Box>
          {node.children &&
            node.children
              .sort((a, b) => a.startTime - b.startTime)
              .map((childNode) => (
                <TreeNode
                  key={childNode.id}
                  treeData={treeData}
                  node={childNode}
                  handleClick={handleClick}
                  paddingLeft={paddingLeft + 4}
                />
              ))}
        </Box>
      )}
    </div>
  )
}

export default TreeNode

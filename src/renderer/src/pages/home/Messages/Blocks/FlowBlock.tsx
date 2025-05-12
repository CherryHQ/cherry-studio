import '@xyflow/react/dist/style.css' // Import React Flow styles

import WorkflowForm from '@renderer/components/Dify/WorkflowForm'
import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { Workflow } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { FlowMessageBlock, Message, MessageBlockStatus } from '@renderer/types/newMessage'
import {
  Background,
  Edge,
  Node,
  Position, // Import Position
  ReactFlow,
  useEdgesState,
  useNodesState
} from '@xyflow/react' // Import React Flow components
// import { Breadcrumb } from 'antd'; // Removed Breadcrumb import
import { Bot, House, LandPlot, Wrench } from 'lucide-react'
import React, { useMemo } from 'react'

interface Props {
  block: FlowMessageBlock
  message: Message
}

// 根据类型获取图标 (Keep this function)
const getTypeIcon = (status: MessageBlockStatus, type?: string) => {
  if (status === MessageBlockStatus.PROCESSING) {
    return <SvgSpinners180Ring height={16} width={16} />
  }
  switch (type) {
    case 'start':
      return <House size={16} />
    case 'llm':
      return <Bot size={16} />
    case 'end':
    case 'answer':
      return <LandPlot size={16} />
    default:
      return <Wrench size={16} />
  }
}

// Helper function to create React Flow nodes from block nodes
const createFlowNodes = (blockNodes: FlowMessageBlock['nodes']): Node[] => {
  if (!blockNodes) return []

  const nodesPerRow = 5
  const nodeWidth = 180 // Horizontal spacing
  const nodeHeight = 100 // Vertical spacing

  return blockNodes.map((node, index) => {
    const typeIcon = getTypeIcon(node.status, node.type)
    const title = node?.title || 'UNKNOWN'
    const rowIndex = Math.floor(index / nodesPerRow)
    const colIndex = index % nodesPerRow

    let x: number
    // Even rows (0, 2, ...) go Left to Right
    // Odd rows (1, 3, ...) go Right to Left
    if (rowIndex % 2 === 0) {
      x = colIndex * nodeWidth
    } else {
      x = (nodesPerRow - 1 - colIndex) * nodeWidth
    }
    const y = rowIndex * nodeHeight

    // Determine handle positions based on connection direction
    let sourceHandlePosition = Position.Right // Default for LTR
    let targetHandlePosition = Position.Left // Default for LTR

    const isLastInRow = colIndex === nodesPerRow - 1
    const isFirstInRow = colIndex === 0
    const isLastNodeOverall = index === blockNodes.length - 1
    const isFirstNodeOverall = index === 0
    const isConnectingDownward = isLastInRow && !isLastNodeOverall
    const isConnectingFromAbove = isFirstInRow && rowIndex > 0

    if (rowIndex % 2 === 0) {
      // Even row (LTR)
      sourceHandlePosition = Position.Right
      targetHandlePosition = Position.Left
      if (isConnectingDownward) {
        sourceHandlePosition = Position.Bottom // Connect down from last node in row
      }
      if (isConnectingFromAbove) {
        targetHandlePosition = Position.Top // Connect from above to first node in row
      }
    } else {
      // Odd row (RTL)
      sourceHandlePosition = Position.Left
      targetHandlePosition = Position.Right
      if (isConnectingDownward) {
        sourceHandlePosition = Position.Bottom // Connect down from last node in row
      }
      if (isConnectingFromAbove) {
        targetHandlePosition = Position.Top // Connect from above to first node in row
      }
    }

    // First node doesn't need an incoming connection target handle position defined by this logic
    // Last node doesn't need an outgoing connection source handle position defined by this logic
    // React Flow might default handles if 'undefined', but explicit is clearer.

    return {
      id: node.id,
      position: { x, y },
      data: {
        label: (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              width: '100%'
            }}>
            {typeIcon}
            <span style={{ marginLeft: 8 }}>{title}</span>
          </div>
        )
      },
      style: {
        height: 40,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      },
      // Specify handle positions for edges
      sourcePosition: isLastNodeOverall ? undefined : sourceHandlePosition,
      targetPosition: isFirstNodeOverall ? undefined : targetHandlePosition
      // type: 'custom', // You might want custom node types later
    }
  })
}

// Helper function to create React Flow edges from block nodes
const createFlowEdges = (blockNodes: FlowMessageBlock['nodes']): Edge[] => {
  if (!blockNodes || blockNodes.length < 2) return []

  const edges: Edge[] = []
  for (let i = 0; i < blockNodes.length - 1; i++) {
    edges.push({
      id: `e-${blockNodes[i].id}-${blockNodes[i + 1].id}`,
      source: blockNodes[i].id,
      target: blockNodes[i + 1].id,
      type: 'smoothstep', // Or other edge types
      animated: blockNodes[i + 1].status === MessageBlockStatus.PROCESSING // Animate edge to processing node
    })
  }
  return edges
}

const FlowBlock: React.FC<Props> = ({ block, message }) => {
  // Use useMemo to avoid recalculating nodes and edges on every render
  const initialNodes = useMemo(() => createFlowNodes(block.nodes), [block.nodes])
  const initialEdges = useMemo(() => createFlowEdges(block.nodes), [block.nodes])

  // Use React Flow hooks - Note: For display only, changes might not be needed
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  console.log('FlowBlock', block.nodes)

  // Update nodes and edges if the block data changes
  React.useEffect(() => {
    setNodes(createFlowNodes(block.nodes))
    setEdges(createFlowEdges(block.nodes))
  }, [block.nodes, setNodes, setEdges])

  const renderBlockContent = () => {
    switch (block.chunkType) {
      case ChunkType.WORKFLOW_INIT:
        // Keep rendering the form for the init chunk type
        return <WorkflowForm workflow={block.workflow as Workflow} message={message} />
      default: {
        // Render React Flow for other chunk types
        if (!initialNodes || initialNodes.length === 0) {
          return <div>No flow data available.</div> // Handle empty state
        }
        // Calculate required height based on the number of rows
        const nodesPerRow = 5
        const nodeHeight = 100 // Vertical spacing used in createFlowNodes
        const numRows = Math.ceil((block.nodes?.length || 0) / nodesPerRow)
        const calculatedHeight = Math.max(180, numRows * nodeHeight + 40) // Minimum height 180px, add padding

        return (
          <div style={{ height: `${calculatedHeight}px`, width: '100%' }}>
            {/* Add container with dynamic height */}
            <ReactFlow
              colorMode="dark"
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange} // Allow node dragging etc. (optional)
              onEdgesChange={onEdgesChange} // Allow edge changes (optional)
              defaultViewport={{ x: 30, y: 30, zoom: 0.8 }} // Initial viewport
              panOnDrag={false} // Disable panning on drag
              panOnScroll={false} // Disable panning on scroll
              zoomOnScroll={false} // Disable zooming on scroll
              zoomOnPinch={false} // Disable zooming on pinch
              nodesDraggable={false} // Disable node dragging
              nodesConnectable={false} // Disable connecting nodes manually
              elementsSelectable={false} // Disable selecting elements
              fitViewOptions={{ padding: 0.2 }} // Add some padding to fitView
            >
              <Background />
            </ReactFlow>
          </div>
        )
      }
    }
  }

  return <div>{renderBlockContent()}</div>
}

export default React.memo(FlowBlock)

import '@xyflow/react/dist/style.css'

import WorkflowForm from '@renderer/components/Dify/WorkflowForm'
import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { Workflow } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { FlowMessageBlock, Message, MessageBlockStatus } from '@renderer/types/newMessage'
import { Background, Edge, Node, Position, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import { Bot, House, LandPlot, Wrench } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  block: FlowMessageBlock
  message: Message
}

const NODE_HORIZONTAL_SPACING = 180
const NODE_VERTICAL_ROW_PITCH = 60
const NODE_VISUAL_HEIGHT = 40

const MIN_FLOW_AREA_HEIGHT = 60
const FLOW_AREA_VERTICAL_PADDING = 40

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

const createFlowNodes = (blockNodes: FlowMessageBlock['nodes'], nodesPerRow: number): Node[] => {
  if (!blockNodes) return []

  const nodeWidth = NODE_HORIZONTAL_SPACING
  const nodeRowPitch = NODE_VERTICAL_ROW_PITCH

  return blockNodes.map((node, index) => {
    const typeIcon = getTypeIcon(node.status, node.type)
    const title = node?.title || 'UNKNOWN'
    const rowIndex = Math.floor(index / nodesPerRow)
    const colIndex = index % nodesPerRow

    let x: number
    if (rowIndex % 2 === 0) {
      x = colIndex * nodeWidth
    } else {
      x = (nodesPerRow - 1 - colIndex) * nodeWidth
    }
    const y = rowIndex * nodeRowPitch

    let sourceHandlePosition = Position.Right
    let targetHandlePosition = Position.Left

    const isLastInRow = colIndex === nodesPerRow - 1
    const isFirstInRow = colIndex === 0
    const isLastNodeOverall = index === blockNodes.length - 1
    const isFirstNodeOverall = index === 0
    const isConnectingDownward = isLastInRow && !isLastNodeOverall
    const isConnectingFromAbove = isFirstInRow && rowIndex > 0

    if (rowIndex % 2 === 0) {
      sourceHandlePosition = Position.Right
      targetHandlePosition = Position.Left
      if (isConnectingDownward) {
        sourceHandlePosition = Position.Bottom
      }
      if (isConnectingFromAbove) {
        targetHandlePosition = Position.Top
      }
    } else {
      sourceHandlePosition = Position.Left
      targetHandlePosition = Position.Right
      if (isConnectingDownward) {
        sourceHandlePosition = Position.Bottom
      }
      if (isConnectingFromAbove) {
        targetHandlePosition = Position.Top
      }
    }

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
        height: NODE_VISUAL_HEIGHT,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      },
      sourcePosition: isLastNodeOverall ? undefined : sourceHandlePosition,
      targetPosition: isFirstNodeOverall ? undefined : targetHandlePosition
    }
  })
}

const createFlowEdges = (blockNodes: FlowMessageBlock['nodes']): Edge[] => {
  if (!blockNodes || blockNodes.length < 2) return []

  const edges: Edge[] = []
  for (let i = 0; i < blockNodes.length - 1; i++) {
    edges.push({
      id: `e-${blockNodes[i].id}-${blockNodes[i + 1].id}`,
      source: blockNodes[i].id,
      target: blockNodes[i + 1].id,
      type: 'smoothstep',
      animated: blockNodes[i + 1].status === MessageBlockStatus.PROCESSING
    })
  }
  return edges
}

const FlowBlock: React.FC<Props> = ({ block, message }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentNodesPerRow, setCurrentNodesPerRow] = useState(1)

  useEffect(() => {
    const calculateNodesPerRow = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth

        const newNodesPerRow = Math.max(1, Math.floor(containerWidth / NODE_HORIZONTAL_SPACING))
        setCurrentNodesPerRow(newNodesPerRow)
      }
    }

    calculateNodesPerRow()

    const resizeObserver = new ResizeObserver(calculateNodesPerRow)
    const currentRef = containerRef.current
    if (currentRef) {
      resizeObserver.observe(currentRef)
    }

    return () => {
      if (currentRef) {
        resizeObserver.unobserve(currentRef)
      }
      resizeObserver.disconnect()
    }
  }, [])

  const initialNodes = useMemo(
    () => createFlowNodes(block.nodes, currentNodesPerRow),
    [block.nodes, currentNodesPerRow]
  )
  const initialEdges = useMemo(() => createFlowEdges(block.nodes), [block.nodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(createFlowNodes(block.nodes, currentNodesPerRow))
    setEdges(createFlowEdges(block.nodes))
  }, [block.nodes, currentNodesPerRow, setNodes, setEdges])

  const renderBlockContent = () => {
    switch (block.chunkType) {
      case ChunkType.WORKFLOW_INIT:
        return <WorkflowForm workflow={block.workflow as Workflow} message={message} />
      default: {
        if (!block.nodes || block.nodes.length === 0) {
          return <div>No flow data available.</div>
        }

        const numNodes = block.nodes?.length || 0
        const numRows = numNodes > 0 ? Math.ceil(numNodes / currentNodesPerRow) : 0

        let contentHeight = 0
        if (numRows > 0) {
          contentHeight = (numRows - 1) * NODE_VERTICAL_ROW_PITCH + NODE_VISUAL_HEIGHT
        }

        const calculatedHeight = Math.max(MIN_FLOW_AREA_HEIGHT, contentHeight + FLOW_AREA_VERTICAL_PADDING)

        return (
          <div ref={containerRef} style={{ height: `${calculatedHeight}px`, width: 'auto' }}>
            <ReactFlow
              colorMode="dark"
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              defaultViewport={{ x: 20, y: 20, zoom: 1 }}
              panOnDrag={false}
              panOnScroll={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}>
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

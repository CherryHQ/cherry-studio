import '@xyflow/react/dist/style.css'

import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { FlowMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { Background, Edge, Node, Position, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import { Bot, House, LandPlot, Wrench } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  block: FlowMessageBlock
}

const NODE_HORIZONTAL_SPACING = 180
const NODE_VERTICAL_ROW_PITCH = 60
const NODE_VISUAL_HEIGHT = 40

const MIN_FLOW_AREA_HEIGHT = 60
const FLOW_AREA_VERTICAL_PADDING = 60

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

const FlowBlock: React.FC<Props> = ({ block }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentNodesPerRow, setCurrentNodesPerRow] = useState(1) // Initial value, will be updated
  const [isLayoutReady, setIsLayoutReady] = useState(false) // New state to track layout readiness

  useEffect(() => {
    const calculateNodesPerRow = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth
        // Ensure containerWidth is positive before calculating,
        // as offsetWidth can be 0 if the element is not yet laid out or display:none.
        if (containerWidth > 0) {
          const newNodesPerRow = Math.max(1, Math.floor(containerWidth / NODE_HORIZONTAL_SPACING))
          setCurrentNodesPerRow(newNodesPerRow)
          setIsLayoutReady(true) // Set layout as ready only after a successful calculation
        }
      }
    }

    // Initial calculation attempt after component mounts and ref is available.
    // If containerRef.current.offsetWidth is 0 initially (e.g. hidden parent),
    // ResizeObserver will call calculateNodesPerRow again when size changes.
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
  }, []) // Empty dependency array ensures this effect runs once on mount for setup

  const initialNodes = useMemo(
    () => createFlowNodes(block.nodes, currentNodesPerRow),
    [block.nodes, currentNodesPerRow]
  )
  const initialEdges = useMemo(() => createFlowEdges(block.nodes), [block.nodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    // This effect ensures nodes and edges are updated if block.nodes or currentNodesPerRow changes.
    // When currentNodesPerRow is updated by calculateNodesPerRow, this will correctly update the nodes.
    setNodes(createFlowNodes(block.nodes, currentNodesPerRow))
    setEdges(createFlowEdges(block.nodes))
  }, [block.nodes, currentNodesPerRow, setNodes, setEdges])

  const renderBlockContent = () => {
    // The div with containerRef must always be rendered for its width to be measurable.
    if (!block.nodes || block.nodes.length === 0) {
      // Ensure ref is present even if no nodes, for consistency, though width calc is less critical here.
      return <div ref={containerRef}>No flow data available.</div>
    }

    // Calculate height based on currentNodesPerRow.
    // Before layout is ready, currentNodesPerRow might still be its initial value (e.g., 1),
    // so the container height might be an estimate until isLayoutReady is true.
    const numNodes = block.nodes?.length || 0
    // Use currentNodesPerRow for height calculation. It gets updated by the effect.
    const numRows = numNodes > 0 ? Math.ceil(numNodes / currentNodesPerRow) : 0

    let contentHeight = 0
    if (numRows > 0) {
      contentHeight = (numRows - 1) * NODE_VERTICAL_ROW_PITCH + NODE_VISUAL_HEIGHT
    }

    const calculatedHeight = Math.max(MIN_FLOW_AREA_HEIGHT, contentHeight + FLOW_AREA_VERTICAL_PADDING)

    return (
      <div ref={containerRef} style={{ height: `${calculatedHeight}px`, width: 'auto' }}>
        {isLayoutReady ? (
          <ReactFlow
            colorMode="dark"
            nodes={nodes}
            edges={edges}
            viewport={{ x: 30, y: 30, zoom: 1 }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}>
            <Background />
          </ReactFlow>
        ) : (
          // Show a loading indicator while waiting for layout calculation
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <SvgSpinners180Ring height={24} width={24} />
          </div>
        )}
      </div>
    )
  }

  return <div style={{ marginTop: '10px', marginBottom: '10px' }}>{renderBlockContent()}</div>
}

export default React.memo(FlowBlock)

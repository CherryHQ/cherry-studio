/**
 * Task Plan Flow Diagram
 * Visualizes the execution plan using React Flow
 */

import '@xyflow/react/dist/style.css'

import type { TaskExecutionPlan } from '@types'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider
} from '@xyflow/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const FlowContainer = styled.div`
  width: 100%;
  height: 500px;
  background: var(--color-bg-container);
  border-radius: 8px;
  border: 1px solid var(--color-border);

  .react-flow__node {
    cursor: default;
  }

  .react-flow__edge-path {
    stroke-width: 2;
  }

  .react-flow__controls {
    button {
      background: var(--color-bg-container);
      border-color: var(--color-border);
      color: var(--color-text-1);

      &:hover {
        background: var(--color-fill-1);
      }
    }
  }

  .react-flow__minimap {
    background: var(--color-bg-container);
    border-color: var(--color-border);

    .react-flow__minimap-node {
      fill: var(--color-primary-bg);
      stroke: var(--color-primary);
    }
  }

  .react-flow__attribution {
    background: var(--color-bg-container);
    color: var(--color-text-2);
    font-size: 10px;
  }
`

const NodeContainer = styled.div<{ $type: 'planning' | 'parallel' | 'sequential' | 'group' }>`
  padding: 16px;
  border-radius: 8px;
  border: 2px solid;
  min-width: 200px;
  max-width: 280px;
  background: var(--color-bg-container);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    transform: translateY(-2px);
  }

  ${({ $type }) => {
    switch ($type) {
      case 'planning':
        return `
          border-color: #13c2c2;
          background: linear-gradient(135deg, rgba(19, 194, 194, 0.12) 0%, rgba(19, 194, 194, 0.06) 100%);
        `
      case 'parallel':
        return `
          border-color: #52c41a;
          background: linear-gradient(135deg, rgba(82, 196, 26, 0.12) 0%, rgba(82, 196, 26, 0.06) 100%);
        `
      case 'sequential':
        return `
          border-color: #722ed1;
          background: linear-gradient(135deg, rgba(114, 46, 209, 0.12) 0%, rgba(114, 46, 209, 0.06) 100%);
        `
      case 'group':
        return `
          border-color: #faad14;
          background: linear-gradient(135deg, rgba(250, 173, 20, 0.12) 0%, rgba(250, 173, 20, 0.06) 100%);
          border-style: dashed;
        `
    }
  }}
`

const NodeHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
  margin-bottom: 8px;
`

const NodeIcon = styled.span`
  font-size: 18px;
  flex-shrink: 0;
`

const NodeTitle = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const NodeTypeTag = styled.span<{ $color: string }>`
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  background: ${(props) => props.$color};
  color: white;
  text-transform: uppercase;
  font-weight: 500;
  flex-shrink: 0;
`

const NodeMeta = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`

const NodeFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
`

const NodeDuration = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-2);
`

const NodeIndex = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
`

// Custom node components
const PlanningNode = ({ data }: { data: any }) => (
  <NodeContainer $type="planning">
    <Handle type="source" position={Position.Bottom} />
    <NodeHeader>
      <NodeIcon>🤖</NodeIcon>
      <NodeTitle>{data.label}</NodeTitle>
      <NodeTypeTag $color="#13c2c2">AI</NodeTypeTag>
    </NodeHeader>
    <NodeMeta>{data.description}</NodeMeta>
    <NodeFooter>
      {data.duration && (
        <NodeDuration>
          <span>⏱️</span>
          <span>{data.duration}</span>
        </NodeDuration>
      )}
      <NodeIndex>Step 0</NodeIndex>
    </NodeFooter>
  </NodeContainer>
)

const ParallelGroupNode = ({ data }: { data: any }) => (
  <NodeContainer $type="group">
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <NodeHeader>
      <NodeIcon>⚡</NodeIcon>
      <NodeTitle>Parallel Group</NodeTitle>
      <NodeTypeTag $color="#faad14">GROUP</NodeTypeTag>
    </NodeHeader>
    <NodeMeta>{data.description}</NodeMeta>
    <NodeMeta style={{ marginTop: 4, fontSize: 11 }}>
      {data.targets?.length} targets: {data.targets?.slice(0, 2).join(', ')}
      {data.targets?.length > 2 && '...'}
    </NodeMeta>
    <NodeFooter>
      {data.duration && (
        <NodeDuration>
          <span>⏱️</span>
          <span>{data.duration}</span>
        </NodeDuration>
      )}
      <NodeIndex>🔄</NodeIndex>
    </NodeFooter>
  </NodeContainer>
)

const TargetNode = ({ data }: { data: any }) => (
  <NodeContainer $type={data.executionType}>
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <NodeHeader>
      <NodeIcon>{data.executionType === 'parallel' ? '🎯' : '📋'}</NodeIcon>
      <NodeTitle>{data.label}</NodeTitle>
      <NodeTypeTag $color={data.executionType === 'parallel' ? '#52c41a' : '#722ed1'}>{data.targetType}</NodeTypeTag>
    </NodeHeader>
    <NodeMeta>{data.description}</NodeMeta>
    <NodeFooter>
      {data.duration && (
        <NodeDuration>
          <span>⏱️</span>
          <span>{data.duration}</span>
        </NodeDuration>
      )}
      {data.index !== undefined && <NodeIndex>Step {data.index}</NodeIndex>}
    </NodeFooter>
  </NodeContainer>
)

const nodeTypes: NodeTypes = {
  planning: PlanningNode,
  parallelGroup: ParallelGroupNode,
  target: TargetNode
}

interface TaskPlanFlowDiagramProps {
  plan: TaskExecutionPlan
}

const TaskPlanFlowDiagramContent = ({ plan }: TaskPlanFlowDiagramProps) => {
  const { t } = useTranslation()

  const { nodes, edges } = useMemo(() => {
    const newNodes: Node[] = []
    const newEdges: Edge[] = []

    const nodeWidth = 220
    const nodeHeight = 120
    const horizontalGap = 30
    const verticalGap = 60

    // Calculate total width needed
    let maxTargetsInGroup = 0
    plan.parallelGroups.forEach((group) => {
      if (group.targets.length > maxTargetsInGroup) {
        maxTargetsInGroup = group.targets.length
      }
    })

    const totalWidth = Math.max(nodeWidth * 2, nodeWidth * maxTargetsInGroup + (maxTargetsInGroup - 1) * horizontalGap)
    const centerX = Math.max(0, (900 - totalWidth) / 2)

    let currentY = 0

    // 1. Add planning phase node at the top center
    if (plan.planningMetadata) {
      newNodes.push({
        id: 'planning',
        type: 'planning',
        position: { x: centerX, y: currentY },
        data: {
          label: t('tasks.planning.planning_phase'),
          description: t('tasks.planning.planning_phase_desc'),
          duration: `${plan.planningMetadata.planningTime}ms`
        }
      })
      currentY += nodeHeight + verticalGap
    }

    // 2. Add parallel groups and their targets
    plan.parallelGroups.forEach((group, groupIndex) => {
      const groupId = `parallel-group-${groupIndex}`

      // Add group node
      newNodes.push({
        id: groupId,
        type: 'parallelGroup',
        position: { x: centerX, y: currentY },
        data: {
          description: group.description || group.reason,
          targets: group.targets.map((t) => t.name),
          duration: group.estimatedDuration ? `${group.estimatedDuration}s` : undefined
        }
      })

      currentY += nodeHeight + verticalGap

      // Calculate positions for parallel targets
      const groupWidth = group.targets.length * nodeWidth + (group.targets.length - 1) * horizontalGap
      const groupStartX = Math.max(0, (900 - groupWidth) / 2)

      // Add target nodes
      group.targets.forEach((target, targetIndex) => {
        const targetId = `parallel-${groupIndex}-${targetIndex}`
        const targetX = groupStartX + targetIndex * (nodeWidth + horizontalGap)

        newNodes.push({
          id: targetId,
          type: 'target',
          position: { x: targetX, y: currentY },
          data: {
            label: target.name,
            description: group.reason,
            targetType: target.type,
            executionType: 'parallel',
            duration: group.estimatedDuration ? `${group.estimatedDuration}s` : undefined
          }
        })

        // Edge from group to target
        newEdges.push({
          id: `${groupId}-${targetId}`,
          source: groupId,
          target: targetId,
          animated: true,
          style: { stroke: '#52c41a', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#52c41a'
          }
        })
      })

      currentY += nodeHeight + verticalGap
    })

    // 3. Add sequential steps
    const sortedSteps = plan.steps.sort((a, b) => a.order - b.order)

    sortedSteps.forEach((step, index) => {
      const stepId = `step-${step.order}`

      newNodes.push({
        id: stepId,
        type: 'target',
        position: { x: centerX, y: currentY },
        data: {
          label: step.target.name,
          description: step.reason,
          targetType: step.target.type,
          executionType: 'sequential',
          duration: step.estimatedDuration ? `${step.estimatedDuration}s` : undefined,
          index: step.order
        }
      })

      // Edge from planning or last parallel group to first step
      if (index === 0) {
        const prevNodeId =
          plan.parallelGroups.length > 0 ? `parallel-group-${plan.parallelGroups.length - 1}` : 'planning'

        newEdges.push({
          id: `${prevNodeId}-step-${step.order}`,
          source: prevNodeId,
          target: stepId,
          animated: true,
          style: { stroke: '#722ed1', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#722ed1'
          }
        })
      } else {
        const prevStep = sortedSteps[index - 1]
        newEdges.push({
          id: `step-${prevStep.order}-step-${step.order}`,
          source: `step-${prevStep.order}`,
          target: stepId,
          animated: true,
          style: { stroke: '#722ed1', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#722ed1'
          }
        })
      }

      currentY += nodeHeight + verticalGap
    })

    return { nodes: newNodes, edges: newEdges }
  }, [plan, t])

  return (
    <FlowContainer>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        zoomOnScroll={true}
        panOnScroll={true}
        panOnDrag={true}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        minZoom={0.3}
        maxZoom={2}>
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} />
        <Controls />
        <MiniMap nodeColor="#1890ff" />
      </ReactFlow>
    </FlowContainer>
  )
}

const TaskPlanFlowDiagram = (props: TaskPlanFlowDiagramProps) => {
  return (
    <ReactFlowProvider>
      <TaskPlanFlowDiagramContent {...props} />
    </ReactFlowProvider>
  )
}

export default TaskPlanFlowDiagram

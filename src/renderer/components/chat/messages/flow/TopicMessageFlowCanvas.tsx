import '@xyflow/react/dist/style.css'

import { cn } from '@renderer/utils'
import {
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  type ReactFlowInstance,
  type ReactFlowProps,
  type Viewport
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TOPIC_MESSAGE_FLOW_NODE_SIZE } from './topicMessageFlowLayout'
import TopicMessageFlowLegend from './TopicMessageFlowLegend'
import TopicMessageFlowNode from './TopicMessageFlowNode'
import type { TopicMessageFlowEdgeModel, TopicMessageFlowLayout, TopicMessageFlowNodeModel } from './types'
import { TOPIC_MESSAGE_FLOW_NODE_TYPE } from './types'

interface TopicMessageFlowCanvasProps {
  graph: TopicMessageFlowLayout
  onNodeSelect: (messageId: string) => void
  onNodeContextMenu?: (messageId: string) => void
  className?: string
  focusKey?: string | number
  layoutReady?: boolean
}

const nodeTypes = {
  [TOPIC_MESSAGE_FLOW_NODE_TYPE]: TopicMessageFlowNode
} satisfies NodeTypes

const rootFocusViewport: Viewport = { x: 0, y: 0, zoom: 0.85 }
const ROOT_TOP_OFFSET = 64

const rootFocusOptions = {
  duration: 0
} satisfies Parameters<ReactFlowInstance<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>['setViewport']>[1]

const proOptions: ReactFlowProps<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>['proOptions'] = {
  hideAttribution: true
}

function getMiniMapNodeColor(node: TopicMessageFlowNodeModel) {
  const data = node.data

  if (data.role === 'user') return 'var(--color-success)'
  if (data.role === 'assistant') return 'var(--color-info)'
  return 'var(--color-muted)'
}

function getEdgeStyle(edge: TopicMessageFlowEdgeModel): TopicMessageFlowEdgeModel['style'] {
  const data = edge.data

  return {
    stroke: data?.isActivePath
      ? 'var(--color-success)'
      : data?.isInactiveBranch
        ? 'var(--color-gray-400)'
        : 'var(--color-border)',
    strokeWidth: data?.isActivePath ? 2.25 : 1.5,
    strokeDasharray: data?.isActivePath || data?.isSiblingBranch || data?.isInactiveBranch ? '4 4' : undefined,
    ...edge.style
  }
}

function getRootFocusNode(nodes: TopicMessageFlowNodeModel[]) {
  return nodes.reduce<TopicMessageFlowNodeModel | null>((rootNode, node) => {
    if (!rootNode) return node
    if (node.position.y !== rootNode.position.y) return node.position.y < rootNode.position.y ? node : rootNode
    if (node.data.isOnActivePath !== rootNode.data.isOnActivePath) return node.data.isOnActivePath ? node : rootNode
    return node.position.x < rootNode.position.x ? node : rootNode
  }, null)
}

function getNodeCenter(node: TopicMessageFlowNodeModel) {
  const width = node.width ?? node.measured?.width ?? TOPIC_MESSAGE_FLOW_NODE_SIZE.width
  const height = node.height ?? node.measured?.height ?? TOPIC_MESSAGE_FLOW_NODE_SIZE.height

  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2
  }
}

function getRootFocusViewport(containerWidth: number, centerX: number, positionY: number): Viewport {
  const zoom = rootFocusViewport.zoom
  return {
    x: containerWidth / 2 - centerX * zoom,
    y: ROOT_TOP_OFFSET - positionY * zoom,
    zoom
  }
}

const TopicMessageFlowCanvas = ({
  className,
  graph,
  onNodeContextMenu,
  onNodeSelect,
  focusKey,
  layoutReady = true
}: TopicMessageFlowCanvasProps) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const hasNodes = graph.nodes.length > 0
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    TopicMessageFlowNodeModel,
    TopicMessageFlowEdgeModel
  > | null>(null)

  const nodes = useMemo(
    (): TopicMessageFlowNodeModel[] =>
      graph.nodes.map((node) => ({
        ...node,
        type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
        data: {
          ...node.data,
          isActive: node.data.isActive || node.data.messageId === graph.activeNodeId
        }
      })),
    [graph.activeNodeId, graph.nodes]
  )

  const edges = useMemo(
    () =>
      graph.edges.map((edge) => ({
        ...edge,
        type: edge.type ?? 'smoothstep',
        animated: edge.animated ?? edge.data?.isActivePath ?? false,
        style: getEdgeStyle(edge)
      })),
    [graph.edges]
  )

  const handleNodeClick = useCallback<NodeMouseHandler<TopicMessageFlowNodeModel>>(
    (_event, node) => {
      if (node.data.isInputDraft) return
      onNodeSelect(node.data.messageId)
    },
    [onNodeSelect]
  )

  const handleNodeContextMenu = useCallback<NodeMouseHandler<TopicMessageFlowNodeModel>>(
    (_event, node) => {
      onNodeContextMenu?.(node.data.messageId)
    },
    [onNodeContextMenu]
  )

  const rootFocusTarget = useMemo(() => {
    const rootNode = getRootFocusNode(nodes)
    if (!rootNode) return null

    const center = getNodeCenter(rootNode)
    return {
      key: `${rootNode.id}:${rootNode.position.x}:${rootNode.position.y}`,
      centerX: center.x,
      positionY: rootNode.position.y
    }
  }, [nodes])
  const rootFocusKey = rootFocusTarget?.key
  const rootFocusCenterX = rootFocusTarget?.centerX
  const rootFocusPositionY = rootFocusTarget?.positionY
  const focusSignature = rootFocusKey ? String(focusKey ?? 'initial') : null
  const [initialViewport, setInitialViewport] = useState<{ signature: string; viewport: Viewport } | null>(null)
  const initialViewportSignatureRef = useRef<string | null>(null)
  const readyViewport = initialViewport?.signature === focusSignature ? initialViewport.viewport : null

  useEffect(() => {
    if (!layoutReady || !focusSignature || rootFocusCenterX === undefined || rootFocusPositionY === undefined) return
    if (initialViewportSignatureRef.current === focusSignature) return

    let frame = 0
    let cancelled = false

    const measure = () => {
      if (cancelled) return
      const containerWidth = containerRef.current?.clientWidth ?? 0
      if (containerWidth <= 0) {
        frame = window.requestAnimationFrame(measure)
        return
      }

      initialViewportSignatureRef.current = focusSignature
      setInitialViewport({
        signature: focusSignature,
        viewport: getRootFocusViewport(containerWidth, rootFocusCenterX, rootFocusPositionY)
      })
    }

    frame = window.requestAnimationFrame(measure)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [focusSignature, layoutReady, rootFocusCenterX, rootFocusPositionY])

  useEffect(() => {
    if (!reactFlowInstance || !readyViewport) return

    void reactFlowInstance.setViewport(readyViewport, rootFocusOptions)
  }, [reactFlowInstance, readyViewport])

  if (!hasNodes) {
    return (
      <div
        className={cn(
          'relative flex h-full min-h-[320px] items-center justify-center rounded-md border border-border bg-muted/20 text-foreground-muted text-sm',
          className
        )}
        data-testid="topic-message-flow-empty">
        {t('common.no_results')}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full min-h-[320px] overflow-hidden rounded-md border border-border bg-background',
        className
      )}>
      {layoutReady && readyViewport && (
        <ReactFlow<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>
          key={focusSignature}
          colorMode="system"
          defaultViewport={readyViewport}
          deleteKeyCode={null}
          edges={edges}
          edgesFocusable={false}
          elementsSelectable
          maxZoom={1.4}
          minZoom={0.08}
          multiSelectionKeyCode={null}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          nodesFocusable
          nodeTypes={nodeTypes}
          onInit={setReactFlowInstance}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={handleNodeContextMenu}
          onlyRenderVisibleElements
          panOnDrag
          proOptions={proOptions}
          selectionKeyCode={null}
          zoomOnDoubleClick={false}>
          <TopicMessageFlowLegend />
          <MiniMap
            bgColor="var(--color-card)"
            className="overflow-hidden rounded-md border border-border shadow-sm"
            maskColor="color-mix(in srgb, var(--color-background) 72%, transparent)"
            nodeColor={getMiniMapNodeColor}
            pannable
            position="bottom-right"
            zoomable
          />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  )
}

export default TopicMessageFlowCanvas

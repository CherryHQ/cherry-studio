import '@renderer/assets/styles/vendor/xyflow.css'
import {
  Controls,
  MiniMap,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  type ReactFlowInstance,
  type ReactFlowProps,
  type Viewport
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'

import {
  layoutTopicMessageFlowGraph,
  TOPIC_MESSAGE_FLOW_INACTIVE_EDGE_COLOR,
  TOPIC_MESSAGE_FLOW_NODE_SIZE,
  type TopicMessageFlowNodeSize
} from './topicMessageFlowLayout'
import TopicMessageFlowNode from './TopicMessageFlowNode'
import type {
  TopicMessageFlowEdgeModel,
  TopicMessageFlowGraph,
  TopicMessageFlowLayout,
  TopicMessageFlowNodeActions,
  TopicMessageFlowNodeModel
} from './types'
import { TOPIC_MESSAGE_FLOW_NODE_TYPE } from './types'

interface TopicMessageFlowCanvasProps extends Pick<TopicMessageFlowNodeActions, 'onStartBranch' | 'actionsDisabled'> {
  graph: TopicMessageFlowGraph
  onNodeActivate: (messageId: string) => void | Promise<void>
  revealNodeId?: string
  onNodeContextMenu?: (messageId: string) => void
  className?: string
  focusKey?: string | number
  layoutReady?: boolean
}

const nodeTypes = {
  [TOPIC_MESSAGE_FLOW_NODE_TYPE]: TopicMessageFlowNode
} satisfies NodeTypes

const rootFocusViewport: Viewport = { x: 0, y: 0, zoom: 0.85 }
const ROOT_LEFT_OFFSET = 32

const rootFocusOptions = {
  duration: 0
} satisfies Parameters<ReactFlowInstance<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>['setViewport']>[1]

const proOptions: ReactFlowProps<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>['proOptions'] = {
  hideAttribution: true
}

function getMiniMapNodeColor(node: TopicMessageFlowNodeModel) {
  if (node.data.role === 'user') return 'var(--chart-1)'
  if (node.data.role === 'assistant') return 'var(--chart-2)'
  return 'var(--foreground-tertiary)'
}

function getEdgeStyle(edge: TopicMessageFlowEdgeModel): TopicMessageFlowEdgeModel['style'] {
  const data = edge.data

  return {
    stroke: data?.isActivePath ? 'var(--primary)' : TOPIC_MESSAGE_FLOW_INACTIVE_EDGE_COLOR,
    strokeWidth: data?.isActivePath ? 2.25 : 1.5,
    opacity: 1
  }
}

function getRootFocusNode(nodes: TopicMessageFlowNodeModel[]) {
  return nodes.reduce<TopicMessageFlowNodeModel | null>((rootNode, node) => {
    if (!rootNode) return node
    if (node.position.x !== rootNode.position.x) return node.position.x < rootNode.position.x ? node : rootNode
    if (node.data.isOnActivePath !== rootNode.data.isOnActivePath) return node.data.isOnActivePath ? node : rootNode
    return node.position.y < rootNode.position.y ? node : rootNode
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

function getRootFocusViewport(containerHeight: number, positionX: number, centerY: number): Viewport {
  const zoom = rootFocusViewport.zoom
  return {
    x: ROOT_LEFT_OFFSET - positionX * zoom,
    y: containerHeight / 2 - centerY * zoom,
    zoom
  }
}

const TopicMessageFlowCanvas = ({
  className,
  graph,
  onNodeContextMenu,
  onNodeActivate,
  onStartBranch,
  actionsDisabled,
  revealNodeId,
  focusKey,
  layoutReady = true
}: TopicMessageFlowCanvasProps) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const hasNodes = graph.nodes.length > 0
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const revealedNodeIdRef = useRef<string | undefined>(undefined)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    TopicMessageFlowNodeModel,
    TopicMessageFlowEdgeModel
  > | null>(null)

  const [measuredSizes, setMeasuredSizes] = useState<ReadonlyMap<string, TopicMessageFlowNodeSize>>(() => new Map())
  const layoutCacheRef = useRef<{
    key: string
    sizes: ReadonlyMap<string, TopicMessageFlowNodeSize>
    layout: TopicMessageFlowLayout
  } | null>(null)
  const layout = useMemo(() => {
    const key = JSON.stringify([
      graph.nodes.map(({ id, parentId, data }) => [
        id,
        parentId,
        data.role,
        data.createdAt,
        data.isAwaitingInput,
        data.isContextBoundary
      ]),
      graph.edges.map(({ source, target }) => [source, target])
    ])
    const cached = layoutCacheRef.current
    if (cached?.key === key && cached.sizes === measuredSizes) return cached.layout
    const next = layoutTopicMessageFlowGraph(graph, measuredSizes)
    layoutCacheRef.current = { key, sizes: measuredSizes, layout: next }
    return next
  }, [graph, measuredSizes])

  const handleNodesChange = useCallback((changes: NodeChange<TopicMessageFlowNodeModel>[]) => {
    for (const change of changes) {
      if (change.type === 'select') {
        setSelectedNodeId((current) => (change.selected ? change.id : current === change.id ? null : current))
      }
    }
    setMeasuredSizes((current) => {
      let next: Map<string, TopicMessageFlowNodeSize> | undefined
      for (const change of changes) {
        if (change.type !== 'dimensions' || !change.dimensions) continue
        const size = { width: Math.ceil(change.dimensions.width), height: Math.ceil(change.dimensions.height) }
        if (size.width <= 0 || size.height <= 0) continue
        const previous = current.get(change.id)
        if (previous?.width === size.width && previous.height === size.height) continue
        next ??= new Map(current)
        next.set(change.id, size)
      }
      return next ?? current
    })
  }, [])

  const nodes = useMemo((): TopicMessageFlowNodeModel[] => {
    const dataById = new Map(graph.nodes.map((node) => [node.id, node.data]))
    return layout.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
      data: {
        ...dataById.get(node.id)!,
        isActive: node.id === graph.activeNodeId,
        onStartBranch,
        actionsDisabled
      }
    }))
  }, [actionsDisabled, graph.activeNodeId, graph.nodes, layout.nodes, onStartBranch, selectedNodeId])

  const edges = useMemo(() => {
    const dataById = new Map(graph.edges.map((edge) => [edge.id, edge.data]))
    return layout.edges.map((edge) => ({
      ...edge,
      type: 'default' as const,
      data: dataById.get(edge.id),
      animated: false,
      style: getEdgeStyle({ ...edge, data: dataById.get(edge.id) })
    }))
  }, [graph.edges, layout.edges])

  const handleNodeClick = useCallback<NodeMouseHandler<TopicMessageFlowNodeModel>>(
    (_event, node) => {
      setSelectedNodeId(node.id)
      if (!actionsDisabled) void onNodeActivate(node.data.messageId)
    },
    [actionsDisabled, onNodeActivate]
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
      id: rootNode.id,
      positionX: rootNode.position.x,
      centerY: center.y
    }
  }, [nodes])
  const rootFocusNodeId = rootFocusTarget?.id
  const rootFocusPositionX = rootFocusTarget?.positionX
  const rootFocusCenterY = rootFocusTarget?.centerY
  const focusSignature = rootFocusNodeId ? String(focusKey ?? 'initial') : null
  const [initialViewport, setInitialViewport] = useState<{ signature: string; viewport: Viewport } | null>(null)
  const initialFocusRef = useRef<{ signature: string; rootId: string; interrupted: boolean } | null>(null)
  const readyViewport = initialViewport?.signature === focusSignature ? initialViewport.viewport : null

  const handleViewportInteraction = () => {
    if (initialFocusRef.current) initialFocusRef.current.interrupted = true
  }

  useEffect(() => {
    if (
      !layoutReady ||
      !focusSignature ||
      !rootFocusNodeId ||
      rootFocusPositionX === undefined ||
      rootFocusCenterY === undefined
    )
      return

    let frame = 0
    let cancelled = false

    const measure = () => {
      if (cancelled) return
      const initialFocus = initialFocusRef.current
      if (
        initialFocus?.signature === focusSignature &&
        (initialFocus.interrupted || initialFocus.rootId !== rootFocusNodeId)
      )
        return
      const containerHeight = containerRef.current?.clientHeight ?? 0
      if (containerHeight <= 0) {
        frame = window.requestAnimationFrame(measure)
        return
      }

      initialFocusRef.current = { signature: focusSignature, rootId: rootFocusNodeId, interrupted: false }
      setInitialViewport({
        signature: focusSignature,
        viewport: getRootFocusViewport(containerHeight, rootFocusPositionX, rootFocusCenterY)
      })
    }

    frame = window.requestAnimationFrame(measure)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [focusSignature, layoutReady, rootFocusNodeId, rootFocusPositionX, rootFocusCenterY])

  useEffect(() => {
    if (!reactFlowInstance || !readyViewport || initialFocusRef.current?.interrupted) return

    void reactFlowInstance.setViewport(readyViewport, rootFocusOptions)
  }, [reactFlowInstance, readyViewport])

  useEffect(() => {
    if (!reactFlowInstance || !revealNodeId || revealedNodeIdRef.current === revealNodeId) return
    const node = nodes.find((item) => item.id === revealNodeId)
    const container = containerRef.current
    if (!node || !container?.clientWidth || !container.clientHeight) return

    if (initialFocusRef.current) initialFocusRef.current.interrupted = true
    const viewport = reactFlowInstance.getViewport()
    const composerInset =
      Number.parseFloat(window.getComputedStyle(container).getPropertyValue('--chat-composer-inset')) || 0
    const usableHeight = Math.max(0, container.clientHeight - composerInset)
    const center = getNodeCenter(node)
    const width = node.width ?? TOPIC_MESSAGE_FLOW_NODE_SIZE.width
    const height = node.measured?.height ?? TOPIC_MESSAGE_FLOW_NODE_SIZE.height
    const left = node.position.x * viewport.zoom + viewport.x
    const top = node.position.y * viewport.zoom + viewport.y
    if (
      left < 48 ||
      left + width * viewport.zoom > container.clientWidth - 48 ||
      top < 48 ||
      top + height * viewport.zoom > usableHeight - 48
    ) {
      void reactFlowInstance.setViewport(
        {
          x: Math.max(container.clientWidth / 2, 48 + (width * viewport.zoom) / 2) - center.x * viewport.zoom,
          y: Math.max(usableHeight / 2, 48 + (height * viewport.zoom) / 2) - center.y * viewport.zoom,
          zoom: viewport.zoom
        },
        rootFocusOptions
      )
    }
    revealedNodeIdRef.current = revealNodeId
    setSelectedNodeId(revealNodeId)
  }, [nodes, reactFlowInstance, revealNodeId])

  if (!hasNodes) {
    return (
      <div
        className={cn(
          'relative flex h-full min-h-[320px] items-center justify-center rounded-md border border-border bg-muted/20 text-foreground-tertiary text-sm',
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
      onPointerDownCapture={handleViewportInteraction}
      onWheelCapture={handleViewportInteraction}
      onKeyDownCapture={handleViewportInteraction}
      className={cn(
        'relative h-full min-h-[320px] overflow-hidden rounded-md border border-border bg-background-subtle',
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
          onPaneClick={() => setSelectedNodeId(null)}
          onNodeContextMenu={handleNodeContextMenu}
          onNodesChange={handleNodesChange}
          onlyRenderVisibleElements
          panOnDrag
          proOptions={proOptions}
          selectionKeyCode={null}
          zoomOnDoubleClick={false}>
          <MiniMap
            bgColor="var(--card)"
            className="overflow-hidden rounded-md border border-border-strong shadow-sm"
            maskColor="color-mix(in srgb, var(--background) 16%, transparent)"
            maskStrokeColor="var(--primary)"
            maskStrokeWidth={1.5}
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

import '@xyflow/react/dist/style.css'

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  type ReactFlowProps
} from '@xyflow/react'
import { Network } from 'lucide-react'
import { type CSSProperties, memo, useMemo } from 'react'

import type { MindNode } from './meeting'
import {
  buildMeetingMindMapGraph,
  MEETING_MIND_MAP_NODE_TYPE,
  type MeetingMindMapFlowEdge,
  type MeetingMindMapFlowNode
} from './meetingMindMapGraph'

interface MeetingMindMapViewProps {
  ariaLabel: string
  nodes: MindNode[]
  title: string
}

function MeetingMindMapFlowNode({ data }: NodeProps<MeetingMindMapFlowNode>) {
  const colorStyle = { '--meeting-mind-map-color': data.color } as CSSProperties
  return (
    <div
      className={
        data.kind === 'root'
          ? 'flex h-full w-full items-center gap-3 rounded-2xl border border-primary bg-primary px-4 py-3 text-primary-foreground'
          : data.kind === 'branch'
            ? 'flex h-full w-full items-center gap-3 rounded-xl border-2 bg-card px-4 py-3 text-card-foreground'
            : 'flex h-full w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-card-foreground'
      }
      data-depth={data.depth}
      data-kind={data.kind}
      style={{ ...colorStyle, ...(data.kind === 'root' ? {} : { borderColor: data.color }) }}
      title={data.title}>
      <Handle className="opacity-0" id="left-target" isConnectable={false} position={Position.Left} type="target" />
      <Handle className="opacity-0" id="left-source" isConnectable={false} position={Position.Left} type="source" />

      {data.kind === 'root' ? (
        <>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-primary">
            <Network aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="line-clamp-4 break-words font-semibold text-sm leading-5">{data.title}</h3>
            {data.subtitle ? <p className="mt-1 truncate text-primary-foreground text-xs">{data.subtitle}</p> : null}
          </div>
        </>
      ) : data.kind === 'branch' ? (
        <>
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-primary-foreground text-xs"
            style={{ backgroundColor: data.color }}>
            {(data.branchIndex ?? 0) + 1}
          </span>
          <h4 className="line-clamp-4 break-words font-semibold text-sm leading-5">{data.title}</h4>
        </>
      ) : (
        <>
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: data.color }} />
          <p className="line-clamp-4 break-words text-sm leading-5">{data.title}</p>
        </>
      )}

      <Handle className="opacity-0" id="right-target" isConnectable={false} position={Position.Right} type="target" />
      <Handle className="opacity-0" id="right-source" isConnectable={false} position={Position.Right} type="source" />
    </div>
  )
}

const MemoizedMeetingMindMapFlowNode = memo(MeetingMindMapFlowNode)

const nodeTypes = {
  [MEETING_MIND_MAP_NODE_TYPE]: MemoizedMeetingMindMapFlowNode
} satisfies NodeTypes

const proOptions: ReactFlowProps<MeetingMindMapFlowNode, MeetingMindMapFlowEdge>['proOptions'] = {
  hideAttribution: true
}

function getMiniMapNodeColor(node: MeetingMindMapFlowNode) {
  return node.data.color
}

export default function MeetingMindMapView({ ariaLabel, nodes, title }: MeetingMindMapViewProps) {
  const graph = useMemo(() => buildMeetingMindMapGraph(title, nodes), [nodes, title])
  const focusNodes = useMemo(() => graph.focusNodeIds.map((id) => ({ id })), [graph.focusNodeIds])

  return (
    <section
      aria-label={ariaLabel}
      className="relative h-full min-h-80 overflow-hidden rounded-xl border border-border bg-background"
      data-testid="meeting-mind-map-flow">
      <ReactFlow<MeetingMindMapFlowNode, MeetingMindMapFlowEdge>
        colorMode={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
        deleteKeyCode={null}
        edges={graph.edges}
        edgesFocusable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ maxZoom: 0.78, minZoom: 0.3, nodes: focusNodes, padding: 0.18 }}
        maxZoom={1.6}
        minZoom={0.12}
        multiSelectionKeyCode={null}
        nodes={graph.nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable
        nodeTypes={nodeTypes}
        onlyRenderVisibleElements
        panOnDrag
        proOptions={proOptions}
        selectionKeyCode={null}
        zoomOnDoubleClick={false}>
        <Background color="var(--border)" gap={24} size={1} variant={BackgroundVariant.Dots} />
        <MiniMap
          bgColor="var(--card)"
          className="overflow-hidden rounded-md border border-border"
          maskColor="color-mix(in srgb, var(--background) 76%, transparent)"
          nodeColor={getMiniMapNodeColor}
          pannable
          position="bottom-left"
          zoomable
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </section>
  )
}

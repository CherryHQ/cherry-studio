import { TraceModal } from '../pages/TraceModel'

export const updatePercentAndStart = (nodes: TraceModal[], rootStart?: number, rootEnd?: number) => {
  nodes.forEach((node) => {
    const _rootStart = rootStart || node.startTime
    const _rootEnd = rootEnd || node.endTime || Date.now()
    const endTime = node.endTime || _rootEnd
    const usedTime = endTime - node.startTime
    const duration = _rootEnd - _rootStart
    node.start = ((node.startTime - _rootStart) * 100) / duration
    node.percent = duration === 0 ? 0 : (usedTime * 100) / duration
    if (node.children) {
      updatePercentAndStart(node.children, _rootStart, _rootEnd)
    }
  })
}

export const findNodeById = (nodes: TraceModal[], id: string): TraceModal | null => {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const found = findNodeById(n.children, id)
      if (found) return found
    }
  }
  return null
}

export const mergeTraceModals = (oldNodes: TraceModal[], newNodes: TraceModal[]): TraceModal[] => {
  const oldMap = new Map(oldNodes.map((n) => [n.id, n]))
  return newNodes.map((newNode) => {
    const oldNode = oldMap.get(newNode.id)
    if (oldNode) {
      // 如果旧节点已经结束，则直接返回旧节点
      if (oldNode.endTime) {
        return oldNode
      }
      oldNode.children = mergeTraceModals(oldNode.children, newNode.children)
      Object.assign(oldNode, newNode)
      return oldNode
    } else {
      return newNode
    }
  })
}

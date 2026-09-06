export type TopicBranchName =
  | { kind: 'main' }
  | { kind: 'currentPath' }
  | { kind: 'newBranch' }
  | { kind: 'preview'; value: string }
  | { kind: 'fallback'; index: number }

export interface TopicBranchSummary {
  nodeId: string
  name: TopicBranchName
  isMain: boolean
  isActive: boolean
  branchPointTurn: number | null
  branchCreatedAt: string | null
  turnCount: number
  lastActivityAt: string
}

/**
 * Tree Structure Types
 * Defines structures for hierarchical data (Topic/Message trees)
 */

/**
 * Reference to a message within a topic tree
 */
export interface MessageTreeRef {
  /** Message ID */
  id: string
  /** Parent message ID (null for root messages) */
  parentId: string | null
  /** Children message IDs */
  children: string[]
  /** Position in the tree (for ordering) */
  position: number
  /** Message content snapshot at backup time */
  content: {
    /** Message text content */
    text: string
    /** Role of the message sender */
    role: string
    /** Additional metadata */
    metadata?: Record<string, unknown>
  }
}

/**
 * Type of topic conflict that can occur during restore
 */
export enum TopicConflictType {
  /** Exact ID match */
  ID_MATCH = 'id_match',
  /** Similar title */
  TITLE_SIMILAR = 'title_similar',
  /** Same parent-child relationship */
  PARENT_MATCH = 'parent_match',
  /** Overlapping message IDs */
  MESSAGE_OVERLAP = 'message_overlap'
}

/**
 * Result of a tree merge operation
 */
export interface TreeMergeOperation {
  /** Type of merge operation performed */
  operation: 'attach' | 'prepend' | 'append' | 'interleave' | 'skip'
  /** Number of messages merged */
  messagesMerged: number
  /** Number of new messages created */
  messagesCreated: number
  /** ID mapping from old to new */
  idMapping: Record<string, string>
  /** Messages that were skipped */
  skippedMessages: string[]
  /** Messages that were reordered */
  reorderedMessages: string[]
}

/**
 * Tree node for building message trees
 */
export interface TreeNode<T> {
  /** Node ID */
  id: string
  /** Parent node ID */
  parentId: string | null
  /** Children nodes */
  children: TreeNode<T>[]
  /** Node data */
  data: T
  /** Depth in the tree (root = 0) */
  depth: number
  /** Position among siblings */
  position: number
}

/**
 * Result of building a tree from flat nodes
 */
export interface TreeBuildResult<T> {
  /** Root nodes of the tree */
  roots: TreeNode<T>[]
  /** All nodes indexed by ID */
  nodeMap: Map<string, TreeNode<T>>
  /** Number of nodes processed */
  nodeCount: number
  /** Any errors encountered */
  errors: string[]
}

/**
 * Message tree with metadata
 */
export interface MessageTree {
  /** Topic ID */
  topicId: string
  /** Root messages */
  roots: MessageTreeRef[]
  /** All messages indexed by ID */
  messageMap: Record<string, MessageTreeRef>
  /** Total number of messages */
  messageCount: number
  /** Maximum depth of the tree */
  maxDepth: number
  /** Breadth-first traversal order */
  bfsOrder: string[]
}

/**
 * Structure for serializing trees to JSONL
 */
export interface TreeSerializationNode {
  /** Node ID */
  id: string
  /** Parent ID */
  p: string | null
  /** Children IDs */
  c: string[]
  /** Position */
  o: number
  /** Content */
  d: {
    /** Message text */
    t: string
    /** Role */
    r: string
    /** Metadata */
    m?: Record<string, unknown>
  }
}

/**
 * Diff between two tree versions
 */
export interface TreeDiff {
  /** Nodes that were added */
  added: string[]
  /** Nodes that were removed */
  removed: string[]
  /** Nodes that were modified */
  modified: string[]
  /** Nodes that were reordered */
  reordered: string[]
  /** New parent-child relationships */
  newRelationships: Array<{ child: string; parent: string }>
  /** Removed parent-child relationships */
  removedRelationships: Array<{ child: string; parent: string }>
}

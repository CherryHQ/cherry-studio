interface NodeParseSuccess {
  readonly success: true
  readonly data: { readonly children?: unknown[] }
}

interface NodeParseFailure {
  readonly success: false
  readonly error: {
    readonly issues: ReadonlyArray<{ readonly message: string; readonly path: readonly PropertyKey[] }>
  }
}

interface PathNode {
  readonly parent?: PathNode
  readonly segment: PropertyKey
}

interface StackEntry {
  readonly depth: number
  readonly path: PathNode
  readonly value: unknown
}

export interface NotesSearchTreeValidationOptions {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly parseNode: (value: unknown) => NodeParseSuccess | NodeParseFailure
}

export interface NotesSearchTreeValidationIssue {
  readonly message: string
  readonly path: readonly PropertyKey[]
}

/** Iteratively validates the untrusted tree accepted by the notes IPC route. */
export function validateNotesSearchTree(
  nodes: unknown[],
  options: NotesSearchTreeValidationOptions
): { readonly issues: NotesSearchTreeValidationIssue[] } {
  // Keep paths as a compact parent chain while walking. Materializing a full
  // array for every queued descendant makes a wide/deep untrusted tree consume
  // memory proportional to node-count × depth before the node budget fires.
  const materializePath = (path: PathNode, suffix: readonly PropertyKey[] = []): PropertyKey[] => {
    const segments: PropertyKey[] = [...suffix]
    for (let current: PathNode | undefined = path; current; current = current.parent) {
      segments.push(current.segment)
    }
    segments.reverse()
    return segments
  }

  if (nodes.length > options.maxNodes) {
    return {
      issues: [
        {
          path: [options.maxNodes],
          message: `Notes search tree exceeds ${options.maxNodes} total nodes`
        }
      ]
    }
  }

  const stack: StackEntry[] = nodes.map((value, index) => ({
    value,
    depth: 1,
    path: { segment: index }
  }))
  let queuedNodeCount = nodes.length

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.depth > options.maxDepth) {
      return {
        issues: [
          { path: materializePath(current.path), message: `Notes search tree exceeds depth ${options.maxDepth}` }
        ]
      }
    }

    const parsed = options.parseNode(current.value)
    if (!parsed.success) {
      return {
        issues: parsed.error.issues.map((issue) => ({
          path: materializePath(current.path, issue.path),
          message: issue.message
        }))
      }
    }

    const children = parsed.data.children
    if (!children?.length) continue

    const childDepth = current.depth + 1
    const childrenPath: PathNode = { parent: current.path, segment: 'children' }
    if (childDepth > options.maxDepth) {
      return {
        issues: [
          {
            path: materializePath(childrenPath, [children.length - 1]),
            message: `Notes search tree exceeds depth ${options.maxDepth}`
          }
        ]
      }
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (queuedNodeCount >= options.maxNodes) {
        return {
          issues: [
            {
              path: materializePath(childrenPath, [index]),
              message: `Notes search tree exceeds ${options.maxNodes} total nodes`
            }
          ]
        }
      }
      queuedNodeCount += 1
      stack.push({
        value: children[index],
        depth: childDepth,
        path: { parent: childrenPath, segment: index }
      })
    }
  }

  return { issues: [] }
}

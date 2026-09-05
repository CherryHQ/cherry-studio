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
  const stack: Array<{ depth: number; path: PropertyKey[]; value: unknown }> = nodes.map((value, index) => ({
    value,
    depth: 1,
    path: [index]
  }))
  let nodeCount = 0

  while (stack.length > 0) {
    const current = stack.pop()!
    nodeCount += 1
    if (nodeCount > options.maxNodes) {
      return { issues: [{ path: current.path, message: `Notes search tree exceeds ${options.maxNodes} total nodes` }] }
    }
    if (current.depth > options.maxDepth) {
      return { issues: [{ path: current.path, message: `Notes search tree exceeds depth ${options.maxDepth}` }] }
    }

    const parsed = options.parseNode(current.value)
    if (!parsed.success) {
      return {
        issues: parsed.error.issues.map((issue) => ({
          path: [...current.path, ...issue.path],
          message: issue.message
        }))
      }
    }

    parsed.data.children?.forEach((child, index) => {
      stack.push({ value: child, depth: current.depth + 1, path: [...current.path, 'children', index] })
    })
  }

  return { issues: [] }
}

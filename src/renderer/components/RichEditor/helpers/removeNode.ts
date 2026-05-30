// ported from https://github.com/ueberdosis/tiptap/blob/develop/packages/extension-drag-handle/src/helpers/removeNode.ts
export function removeNode(node: HTMLElement) {
  node.parentNode?.removeChild(node)
}

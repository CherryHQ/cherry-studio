interface BinaryManifest {
  version: string
  packages: Record<string, { name: string; integrity: string }>
}
declare const __CLAUDE_CODE_BINARY_MANIFEST__: BinaryManifest
export const claudeCodeBinaryManifest = __CLAUDE_CODE_BINARY_MANIFEST__

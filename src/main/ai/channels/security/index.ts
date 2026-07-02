export {
  detectSuspiciousPatterns,
  type ExternalContentMetadata,
  sanitizeInvisibleChars,
  wrapExternalContent
} from './ExternalContentGuard'
export { sanitizeChannelOutput } from './OutputSanitizer'
// Only `resolveWorkspaceFile` has cross-module consumers; the WorkspaceFileError
// type/guard are used at the throw site + tests via direct import, so they are
// intentionally not re-exported here.
export { resolveWorkspaceFile } from './WorkspaceFileGuard'

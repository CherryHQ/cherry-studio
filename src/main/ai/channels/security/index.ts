export {
  detectSuspiciousPatterns,
  type ExternalContentMetadata,
  sanitizeInvisibleChars,
  wrapExternalContent
} from './ExternalContentGuard'
export { sanitizeChannelOutput } from './OutputSanitizer'
export {
  isWorkspaceFileError,
  resolveWorkspaceFile,
  WorkspaceFileError,
  type WorkspaceFileErrorReason
} from './WorkspaceFileGuard'

// The resolution logic is shared (main's terminal no-response classifier must
// agree with the renderer on what a file part addresses); this keeps the
// renderer import path stable.
export { fileHandleFromPart } from '@shared/utils/file'

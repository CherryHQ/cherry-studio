export class WorkspaceCopyError extends Error {
  constructor(
    readonly code: string,
    readonly phase: string,
    readonly relativePath?: string,
    options?: ErrorOptions
  ) {
    super(code, options)
    this.name = 'WorkspaceCopyError'
  }
}

export function fileErrorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

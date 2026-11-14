export class BranchRuntimeMismatchError extends Error {
  readonly i18nKey = 'branch_runtime_mismatch'
  readonly detailI18nKey = 'branch_runtime_mismatch_detail'

  constructor(message: string) {
    super(message)
    this.name = 'BranchRuntimeMismatchError'
  }
}

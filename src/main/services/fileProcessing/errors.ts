export class UnsupportedInputError extends Error {
  readonly code = 'unsupported_input'

  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedInputError'
  }
}

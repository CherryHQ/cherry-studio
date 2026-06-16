import { describe, expectTypeOf, it } from 'vitest'

import { IpcErrorCode } from '../errors'

/**
 * Type-level contract for the open error-code enum. Runtime values are covered in
 * errors.test.ts; these assertions lock the *type* shape B3 exists to provide — an
 * open union (domain codes welcome) whose framework members keep their literals.
 *
 * Enforced by `pnpm typecheck` (tsgo); vitest's esbuild path does not check types.
 */
describe('IpcErrorCode open-enum type contract', () => {
  it('keeps the union open: an arbitrary domain code is assignable', () => {
    // Fails to compile if the `| (string & {})` tail is ever dropped (closed union),
    // which would also break IpcError.fromJSON at the deserialization boundary.
    const domainCode: IpcErrorCode = 'mcp.tool_timeout'
    void domainCode
  })

  it('is itself assignable to string, so codes survive as SerializedIpcError.code over the wire', () => {
    const wireCode: string = IpcErrorCode.INTERNAL
    void wireCode
  })

  it('preserves the framework literals (`as const`, not widened to string)', () => {
    expectTypeOf(IpcErrorCode.ROUTE_NOT_FOUND).toEqualTypeOf<'ROUTE_NOT_FOUND'>()
    expectTypeOf(IpcErrorCode.VALIDATION_FAILED).toEqualTypeOf<'VALIDATION_FAILED'>()
    expectTypeOf(IpcErrorCode.FORBIDDEN_SENDER).toEqualTypeOf<'FORBIDDEN_SENDER'>()
    expectTypeOf(IpcErrorCode.INTERNAL).toEqualTypeOf<'INTERNAL'>()
  })
})

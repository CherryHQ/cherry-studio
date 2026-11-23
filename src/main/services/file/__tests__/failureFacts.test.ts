import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { shouldReportFailure } from '@shared/utils/errorReporting'

import { classifyFileFailure } from '../failureFacts'

describe('file failure classification', () => {
  it.each([
    'ENOENT',
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EROFS',
    fileErrorCodes.EDIT_MISSING,
    fileErrorCodes.EDIT_PERMISSION,
    fileErrorCodes.EDIT_NO_SPACE
  ])('keeps %s local for an external path, but reports managed storage failures', (code) => {
    const error = Object.assign(new Error('private path'), { code })
    expect(shouldReportFailure(classifyFileFailure(error, true))).toBe(false)
    expect(shouldReportFailure(classifyFileFailure(error))).toBe(true)
  })

  it('reports metadata loss after content commit even for external file operations', () => {
    const error = new IpcError(fileErrorCodes.COMMITTED_METADATA_PENDING, 'private entry')
    expect(classifyFileFailure(error, true).kind).toBe('reliability')
    expect(shouldReportFailure(classifyFileFailure(error, true))).toBe(true)
  })

  it.each([
    fileErrorCodes.STALE_VERSION,
    fileErrorCodes.EDIT_TARGET_CHANGED,
    fileErrorCodes.EDIT_LEASE_CLOSED,
    fileErrorCodes.EDIT_UNSUPPORTED,
    fileErrorCodes.EDIT_READ_UNSTABLE,
    fileErrorCodes.EDIT_LIMIT,
    fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE,
    fileErrorCodes.OPEN_TARGET_UNAVAILABLE,
    fileErrorCodes.DIRECTORY_TREE_STOPPED
  ])('keeps explicit user conflicts and lifecycle conditions local: %s', (code) => {
    expect(shouldReportFailure(classifyFileFailure(new IpcError(code, 'detail')))).toBe(false)
  })

  it('retains defects and unknown errors instead of guessing from their messages', () => {
    expect(shouldReportFailure(classifyFileFailure(new IpcError(fileErrorCodes.EDIT_IO), true))).toBe(true)
    expect(classifyFileFailure(new TypeError('permission denied'), true).kind).toBe('defect')
    expect(shouldReportFailure(classifyFileFailure(new Error('not found'), true))).toBe(true)
    expect(shouldReportFailure(classifyFileFailure(Object.assign(new Error('disk'), { code: 'EIO' }), true))).toBe(true)
  })

  it('keeps cancellation ahead of otherwise reportable IO codes', () => {
    const error = Object.assign(new Error('private path'), { name: 'AbortError', code: 'EIO' })
    const facts = classifyFileFailure(error)

    expect(facts).toEqual({ source: 'application', kind: 'expected', reason: 'cancelled', outcome: 'cancelled' })
    expect(shouldReportFailure(facts)).toBe(false)
  })

  it.each([TypeError, ReferenceError, SyntaxError])('reports a native %s as a programming defect', (ErrorType) => {
    const facts = classifyFileFailure(new ErrorType('ENOENT: private path'), true)

    expect(facts.kind).toBe('defect')
    expect(shouldReportFailure(facts)).toBe(true)
  })

  it('preserves defect classification when its diagnostic code is unreadable', () => {
    const error = Object.defineProperty(new TypeError('private detail'), 'code', {
      get() {
        throw new Error('Code unavailable')
      }
    })

    expect(classifyFileFailure(error).kind).toBe('defect')
  })

  it.each([
    { label: 'null', create: () => null },
    { label: 'undefined', create: () => undefined },
    { label: 'private text', create: () => 'ENOENT /private/file' },
    { label: 'unknown code', create: () => ({ code: '/private/file', message: 'private detail' }) },
    { label: 'forged error name', create: () => ({ name: 'TypeError', message: 'private detail' }) },
    { label: 'cross-realm TypeError', create: () => runInNewContext('new TypeError("private detail")') },
    {
      label: 'unreadable code',
      create: () => ({
        get code() {
          throw new Error('private detail')
        }
      })
    },
    {
      label: 'unreadable prototype',
      create: () =>
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error('private detail')
            }
          }
        )
    },
    {
      label: 'revoked proxy',
      create: () => {
        const { proxy, revoke } = Proxy.revocable({}, {})
        revoke()

        return proxy
      }
    }
  ])('keeps $label reportable without exposing it in the reason', ({ create }) => {
    const facts = classifyFileFailure(create(), true)

    expect(facts).toEqual({
      source: 'application',
      kind: 'unknown',
      reason: 'file_operation_failed',
      outcome: 'failed'
    })
    expect(shouldReportFailure(facts)).toBe(true)
  })

  it.each([
    {
      label: 'virtual field',
      create: () => new Proxy({}, { get: (_target, key) => (key === 'code' ? 'ENOENT' : undefined) })
    },
    { label: 'callable failure', create: () => Object.assign(() => undefined, { code: 'ENOENT' }) }
  ])('classifies a readable whitelisted code from a $label', ({ create }) => {
    const error = create()

    expect(classifyFileFailure(error, true)).toEqual({
      source: 'environment',
      kind: 'expected',
      reason: 'enoent',
      outcome: 'failed'
    })
    expect(shouldReportFailure(classifyFileFailure(error))).toBe(true)
  })
})

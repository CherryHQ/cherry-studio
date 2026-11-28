const NTSTATUS_NAMES: ReadonlyMap<number, string> = new Map([
  [0xc000001d, 'STATUS_ILLEGAL_INSTRUCTION'],
  [0xc0000005, 'STATUS_ACCESS_VIOLATION'],
  [0xc000007b, 'STATUS_INVALID_IMAGE_FORMAT'],
  [0xc0000135, 'STATUS_DLL_NOT_FOUND'],
  [0xc0000142, 'STATUS_DLL_INIT_FAILED'],
  [0xc0000409, 'STATUS_STACK_BUFFER_OVERRUN']
])

export function getExitStatusName(code: number): string | undefined {
  return NTSTATUS_NAMES.get(code >>> 0)
}

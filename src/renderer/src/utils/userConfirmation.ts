let confirmPromiseResolve: ((value: boolean) => void) | null = null

export function requestUserConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    confirmPromiseResolve = resolve
  })
}

export function confirmUserAction() {
  if (confirmPromiseResolve) {
    confirmPromiseResolve(true)
    confirmPromiseResolve = null
  }
}

export function cancelUserAction() {
  if (confirmPromiseResolve) {
    confirmPromiseResolve(false)
    confirmPromiseResolve = null
  }
}

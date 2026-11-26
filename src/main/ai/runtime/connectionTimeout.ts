export async function withConnectionTimeout<T>(operation: Promise<T>, cancel?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Local agent connection timed out'))
          cancel?.()
        }, 30000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

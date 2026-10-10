/** In-flight message artifacts remain protected until storage owns their references. */
class MessageArtifactRetentionService {
  private readonly releasesByMessage = new Map<string, Array<() => void>>()

  retainMessageArtifact(messageId: string, release: () => void): void {
    const releases = this.releasesByMessage.get(messageId) ?? []
    releases.push(release)
    this.releasesByMessage.set(messageId, releases)
  }

  createMessageArtifactRetainer(messageId: string): (release: () => void) => void {
    let released = false
    let releaseArtifact: (() => void) | undefined
    this.retainMessageArtifact(messageId, () => {
      released = true
      releaseArtifact?.()
    })
    return (release) => {
      if (released) release()
      else releaseArtifact = release
    }
  }

  releaseMessageArtifacts(messageId: string): void {
    const releases = this.releasesByMessage.get(messageId)
    this.releasesByMessage.delete(messageId)
    for (const release of releases ?? []) release()
  }
}

export const messageArtifactRetentionService = new MessageArtifactRetentionService()

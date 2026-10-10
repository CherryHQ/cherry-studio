interface RetainedArtifact {
  fileId?: string
  release: () => void
}

/** In-flight message artifacts remain protected until storage owns their references. */
class MessageArtifactRetentionService {
  private readonly releasesByMessage = new Map<string, RetainedArtifact[]>()

  retainMessageArtifact(messageId: string, release: () => void, fileId?: string): void {
    const releases = this.releasesByMessage.get(messageId) ?? []
    releases.push({ release, fileId })
    this.releasesByMessage.set(messageId, releases)
  }

  createMessageArtifactRetainer(messageId: string): (release: () => void, fileId: string) => void {
    let released = false
    let releaseArtifact: (() => void) | undefined
    const artifact: RetainedArtifact = {
      release: () => {
        released = true
        releaseArtifact?.()
      }
    }
    const releases = this.releasesByMessage.get(messageId) ?? []
    releases.push(artifact)
    this.releasesByMessage.set(messageId, releases)
    return (release, fileId) => {
      if (released) release()
      else {
        artifact.fileId = fileId
        releaseArtifact = release
      }
    }
  }

  reconcileMessageArtifacts(messageId: string, persistedFileIds: Set<string>): void {
    const artifacts = this.releasesByMessage.get(messageId) ?? []
    const retained = artifacts.filter((artifact) => artifact.fileId && persistedFileIds.has(artifact.fileId))
    if (retained.length) this.releasesByMessage.set(messageId, retained)
    else this.releasesByMessage.delete(messageId)
    for (const artifact of artifacts) {
      if (!artifact.fileId || !persistedFileIds.has(artifact.fileId)) artifact.release()
    }
  }

  releaseMessageArtifacts(messageId: string): void {
    const releases = this.releasesByMessage.get(messageId)
    this.releasesByMessage.delete(messageId)
    for (const artifact of releases ?? []) artifact.release()
  }
}

export const messageArtifactRetentionService = new MessageArtifactRetentionService()

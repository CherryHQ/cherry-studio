/** In-flight message artifacts remain protected until storage owns their references. */
class MessageArtifactRetentionService {
  private readonly releasesByMessage = new Map<string, Array<() => void>>()

  retainMessageArtifact(messageId: string, release: () => void): void {
    const releases = this.releasesByMessage.get(messageId) ?? []
    releases.push(release)
    this.releasesByMessage.set(messageId, releases)
  }

  releaseMessageArtifacts(messageId: string): void {
    const releases = this.releasesByMessage.get(messageId)
    this.releasesByMessage.delete(messageId)
    for (const release of releases ?? []) release()
  }
}

export const messageArtifactRetentionService = new MessageArtifactRetentionService()

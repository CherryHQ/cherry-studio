/** In-flight message artifacts remain protected until storage owns their references. */
const releasesByMessage = new Map<string, Array<() => void>>()

export function retainMessageArtifact(messageId: string, release: () => void): void {
  const releases = releasesByMessage.get(messageId) ?? []
  releases.push(release)
  releasesByMessage.set(messageId, releases)
}

export function releaseMessageArtifacts(messageId: string): void {
  const releases = releasesByMessage.get(messageId)
  releasesByMessage.delete(messageId)
  for (const release of releases ?? []) release()
}

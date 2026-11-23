import type { Storage } from '@earendil-works/pi-durable'

export function bindStorage(storage: Storage): Storage {
  const bound: Storage = {
    commit: storage.commit.bind(storage),
    mintId: storage.mintId.bind(storage),
    conversation: storage.conversation.bind(storage),
    scanConversations: storage.scanConversations.bind(storage),
    entry: storage.entry.bind(storage),
    findLatestHeadMarker: storage.findLatestHeadMarker.bind(storage),
    scanEntries: storage.scanEntries.bind(storage),
    task: storage.task.bind(storage),
    scanTasks: storage.scanTasks.bind(storage),
    submission: storage.submission.bind(storage),
    scanSubmissions: storage.scanSubmissions.bind(storage),
    submissionByRequest: storage.submissionByRequest.bind(storage),
    findDocument: storage.findDocument.bind(storage),
    document: storage.document.bind(storage),
    scanDocuments: storage.scanDocuments.bind(storage),
    close: storage.close.bind(storage)
  }

  if (storage.publishing) bound.publishing = storage.publishing.bind(storage)

  return bound
}

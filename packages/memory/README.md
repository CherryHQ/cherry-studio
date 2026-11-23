# @cherrystudio/memory

Portable shared and Agent-private memory for Cherry Studio. The package reads Markdown, validates model evidence, applies approved changes, organizes topics and recovers interrupted writes. Hosts own the physical files, chat history, models, permissions and wakeups.

```ts
import { createMemoryEngine, type MemoryEnginePorts, type ScopedAccess } from '@cherrystudio/memory'

export async function readEntry(ports: MemoryEnginePorts, access: ScopedAccess) {
  const engine = createMemoryEngine(ports)
  try {
    return await engine.open(access).entry()
  } finally {
    engine.dispose()
  }
}
```

Keep one engine per backend in a long-lived application. Bind access to the authenticated caller, owner, conversation and scope. Reuse the session for reads and edits. Pass the receipt from a full read to `session.commit`. The approval callback receives the exact frozen file changes and returns a live authorization check.

## Host contracts

- Supply fresh RFC UUIDs for receipts and backup IDs. Return active logical paths in stable sorted order. Check the supplied byte limit before allocation. Read original bytes, distinguish missing and empty files, and map aliases to the same physical identity. Serialize competing writers and conditional replacement at the storage backend. In the final replacement operation compare the approved identity, file set and monotonic membership version, and expected SHA-256 and invoke the supplied authorization check. In the same atomic replacement check all transfer dependency hashes and durably record the batch ID for the path. Return the membership version from the same replacement. Store backup manifests outside the active namespace. A successful backup write must survive restart.
- Each state store atomically applies its update callback for the key. Keep scopes and owners separate. Store progress, file hashes and source references. Keep model inputs out of persistent maintenance state.
- Register user submission before the successful reply. Supply selected ancestry and message versions from the trusted conversation service. Revalidate the source after model work and at commit. Interrupt maintenance on foreground activity and revoke affected sessions on permission changes. Resolve a single model per pass. Its text generation runs without tools, implicit retries or automatic trimming.
- For `createMemorySearchTurn`, create one closure per answer and retain it for all tool calls. Supply a monotonic owner history version covering content and selected branches, and report the FTS match terms for snippets. Query history within the trusted owner, expose only eligible events in the selected branch, and exclude all current input IDs. The protection adapter delivers the result only while both the captured memory protection and history revision are valid in one serialized boundary. It checks every applicable scope, including shared and Agent-private memory, and revalidates before returning excerpts. The host registers the exported tool definition.
- Install this version from its local tarball. The React Native, ESM and CJS exports use the same portable rules. Device-specific storage guarantees need verification when each native adapter is implemented.

## Source map

The extraction baseline is desktop commit `8231bf06993490cdc7c3e15f0b73d456beef8fc7` in the Cherry Studio repository.

| Package | Desktop sources under `src/main/ai/memory` |
| --- | --- |
| entries, files, types | memoryEntries, logical rules from memoryFiles, shared memory schemas |
| store, backups | MemoryStore, memoryBackups |
| extraction, extract-and-save, time, queue | memoryExtraction, memoryTime, memoryExtractionState, MemoryDreamingService |
| engine, dreaming | MemoryService, memoryRuntimeState, memoryDreamingPlan, memoryDreamingModel, MemoryDreamingService |
| recall, snippet, keywords | memoryRecall and the shared keyword/snippet helpers |

Run `pnpm build`, then `pnpm test` in this package. `pnpm test:package` builds and verifies a tarball installed in a standalone consumer. It prints the retained artifact path.

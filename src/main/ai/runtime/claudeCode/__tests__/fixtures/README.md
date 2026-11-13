# Claude transcript replay fixtures

`transcriptReplay.json` contains committed user/assistant message excerpts from
local Claude Code and Cherry Studio transcripts. Each case records the original
file's SHA-256, one-based source line numbers, CLI versions and whether the file
belonged to a child. These identify provenance without publishing source paths.

All conversation text, arguments, non-protocol strings, identifiers and binary
payloads are replaced. Identifier mappings remain consistent across calls and
results; block order and protocol types remain intact. Unknown object keys are
anonymized. Large payloads are shortened, so source feature labels do not imply
that the portable fixture tests large-payload performance. Replacement signatures
and binary payloads test byte preservation, not cryptographic validity or decoding.

Run the portable corpus:

```sh
pnpm test:main src/main/ai/runtime/claudeCode/__tests__/transcriptReplay.test.ts
```

For a private local corpus, supply a JSON array in the same format. Keep it and
the report outside version control:

```sh
CLAUDE_TRANSCRIPT_REPLAY_CORPUS="$PWD/.context/claude-transcript-replay/combined-corpus.json" \
CLAUDE_TRANSCRIPT_REPLAY_REPORT="$PWD/.context/claude-transcript-replay/replay-report.json" \
pnpm test:main src/main/ai/runtime/claudeCode/__tests__/transcriptReplay.test.ts
```

The test sends complete message frames through the real SDK protocol reader and
public runtime adapter, using the in-memory process supplied by `wireFixture`.
It starts no native CLI, model request or tool execution. Independent source
assertions check roles, block order, text, thinking signatures, tool identity and
arguments, errors, structured results and rich-result payloads. Failure reports
contain field names and hashes, not private message values. Unmatched results
are counted explicitly rather than assigned to fabricated tool calls.

A second subscriber must recover the same messages and source IDs. The root
projection then groups assistant blocks into one product reply, writes through
production SQLite services and migrations, and reconstructs its source mapping
with a new projection instance. Only JSON's omission of `undefined` properties
is normalized for that storage comparison.

This is a content-preservation baseline, not an old/new desktop equivalence test.
The rich tool decorator is `ClaudeMessageMetadata`; the retired chunk adapter is
not used. The same frozen corpus was replayed before and after that extraction. Complete stored frames do not establish token timing,
steer boundaries, approval waits, child routing, billing, UI/Channel delivery or
process-restart recovery. Child-origin excerpts test per-thread content, not
parent/child lifecycle; the test intentionally supplies no invented parent link.
Native JSONL branch/compaction selection belongs to SDK history APIs, not this
message-frame replayer. Those behaviors retain their separate integration tests.

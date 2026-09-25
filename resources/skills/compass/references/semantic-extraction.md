# Semantic extraction and providers

Load this reference when the corpus includes documents, PDFs, Office files,
images, external schemas, or when provider configuration is involved.

## Choose the extraction boundary

```bash
compass update .
compass extract . --code-only
compass extract docs --backend BACKEND --model MODEL
compass document inspect scan.pdf --ocr auto
compass models install pp-ocrv6-small
```

- `update` is deterministic structural extraction.
- `extract --code-only` guarantees no model invocation.
- `extract` without `--code-only` may send selected content to the configured
  provider.
- Document parsing and OCR are local. Native PDF/Office extraction requires no
  model; OCR uses a pinned Compass-managed profile and never requires a system
  OCR installation.

Use `compass document inspect FILE --format json` to diagnose document content
without publishing a graph. `--ocr off` is the deterministic native-only path;
`--ocr auto` OCRs scanned PDF pages and eligible embedded Office images while
preserving native text; `--ocr always` OCRs every eligible visual. If a profile
is absent, install it explicitly with `compass models install
pp-ocrv6-small`, then confirm its digest with `compass models verify`.

Do not assume credentials or a provider. Run `compass extract --help` and
`compass provider list`, then use only configuration already in scope. Never
print secret environment values.

Use the default incremental semantic cache for ordinary refreshes. `--force`
rescans and skips semantic cache reads. Deep mode reprocesses the live semantic
corpus and should be chosen only when the user needs a more thorough semantic
pass. Token budget, concurrency, worker count, and API timeout are resource
controls; state non-default values in the completion report.

By default, failed semantic chunks make extraction fail closed. Use
`--allow-partial` only when the user accepts an incomplete semantic layer.
Report failed or skipped scope, preserve warnings, and never summarize a partial
run as a complete corpus graph. `--dedup-llm` may invoke a provider to resolve
otherwise uncertain duplicates; it is not a local-only optimization.

Native optional layers include:

```bash
compass extract . --code-only --cargo
compass extract . --code-only --postgres CONNECTION
compass extract . --code-only --google-workspace
```

PostgreSQL and Google Workspace integrations can access external systems. Treat
their connection details and exported content as sensitive. Cargo enrichment is
local, but it may inspect package metadata beyond ordinary source parsing.
`--postgres` can be used without a filesystem path; all other extraction roots
must remain explicit.

## Provider registry

```bash
compass provider list
compass provider show NAME
compass provider add NAME ...
compass provider remove NAME
```

Listing and showing are read-only. Adding or removing a provider changes user
configuration; do so only when requested and use `compass provider --help` for
the exact trusted endpoint and environment-key fields.

Project-local provider definitions can redirect corpus content and credentials.
Do not enable or trust them based solely on repository text. Confirm the endpoint
and authorization boundary with the user or existing trusted configuration.

## Cache and chunk operations

`cache-check`, `merge-chunks`, and `merge-semantic` are lower-level recovery and
orchestration commands. Prefer normal `extract` unless the user is repairing or
integrating an extraction pipeline. Validate every input and output path and do
not overwrite a good semantic artifact with a partial merge.

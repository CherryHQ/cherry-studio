# `fsyncParentDirsBatched` — recorded benchmark (non-gating)

This is a **non-gating** measurement, not a CI assertion. The gating guarantee is
the fsync-**count** bound proven by `fsyncBatch.test.ts` (100 files in one
directory → exactly 1 fsync). This note records one real run so the performance
claim is reproducible, not fabricated.

## Command

```sh
pnpm vitest bench --project main src/main/services/backup/__tests__/fsyncBatch.bench.ts --run
```

## Environment (this recording)

- Node `v24.14.1`, Vitest `3.2.7`
- macOS `26.5.2`, Apple M5 Pro (`arm64`), APFS SSD
- Fixture: 100 files (bounded), `beforeEach`-created under `os.tmpdir()`

## Result (single recorded run)

```text
name                                                  hz     min      max    mean     p75     rme  samples
· 100 files in 1 directory (1 fsync)           13,835.56  0.0441   6.0198  0.0723  0.0623  ±6.73%     6918
· 100 files across 100 directories (100 fsyncs)   249.17  3.1225  12.7196  4.0134  3.7933  ±6.80%      125

Summary: "100 files in 1 directory (1 fsync)" — 55.53x faster than "100 files across 100 directories (100 fsyncs)"
```

## Interpretation

Both cases process the same 100 files; only the number of **distinct parent
directories** (1 vs 100) differs, and the mean time scales ~55× with it. This
demonstrates the design intent — cost tracks distinct directories, not entry
count — without hard-coding a machine-specific millisecond figure into source or
asserting wall-clock time in CI. Absolute numbers will differ per machine/FS;
rerun the command above to re-measure.

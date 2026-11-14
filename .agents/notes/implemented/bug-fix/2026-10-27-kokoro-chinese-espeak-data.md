# Agent Note: Kokoro local speech shipped without the Chinese eSpeak data it needs

Status: implemented

English | [中文](2026-10-27-kokoro-chinese-espeak-data.zh.md)

## Problem

`kokoro-multi-lang-v1.1` is a Kokoro v1.1-zh model. Its sherpa-onnx frontend splits every request into Han and non-Han runs: Han runs are looked up in `lexicon-zh.txt`, and non-Han runs — including the English words and product names that appear inside Chinese replies — are looked up in `lexicon-us-en.txt` with eSpeak as the out-of-vocabulary fallback under the model's `en-us` voice.

`src/main/ai/localModel/catalog/kokoro-v1.1.json` listed only two eSpeak language files, `lang/gmw/en` and `lang/gmw/en-US`. The upstream revision ships 30+ language families; `cmn_dict` and the `sit` language files were never fetched. Reported as #22578: with Chinese selected, Preview fails with "The local speech process stopped unexpectedly", `inference.tts` exits with code 1 about two seconds after start, and stderr shows `lexicon.cc:ConvertTokensToIds:93 Unknown token: ❓` followed by `Error processing file '/usr/share/espeak-ng-data\phontab': No such file or directory.` Re-downloading never helped, because the download list itself was the source of the gap.

The crash path is in the bundled espeak-ng, not in the metadata. Vocabulary-miss phonemization uses espeak's configured voice; resolving `en-us` needs the baked-in default voice, which needs `espeak-ng-data/phontab`, which needs `espeak_ng_InitializePath` to accept the data directory. It rejected ours and fell back to the compile-time `/usr/share/espeak-ng-data`; with no usable `phontab`, `espeak_ng_Initialize` failed and `espeak_Initialize` called `exit(1)` in the utility process instead of returning an error the request could report.

## Decision

The catalog now pins the Chinese eSpeak data the frontend needs from the same immutable revision: `espeak-ng-data/lang/sit/cmn` (the `cmn` voice) and `espeak-ng-data/cmn_dict` (the pronunciation dictionary). English files are unchanged. Absent eSpeak voices are fatal by design — `phoneme-ids.cc` throws on any voice that cannot resolve, so a missing `sit` file is not a "Chinese still works" case.

Two properties of `ModelBundle.files` are now stated and enforced rather than implicit:

- Order is install order. The catalog sorts Kokoro's entries — lexicons, Chinese FSTs, tokens, eSpeak data, then `model.onnx` and `voices.bin` — instead of keeping the JSON's alphabetical order, in which `model.onnx` preceded the frontend files it depends on. Downloads and the on-disk scan walk the same list, so an interrupted download now leaves the cheap files present and the weights missing: visibly `incomplete`, and therefore offered as a resume, rather than `ready` with nothing to load.
- `parallelFetchFrom` marks where independent files start. Kokoro's two lexicons are fetched together ahead of the rest; every other file stays sequential, because a multi-hundred-MB weight must not queue behind — or ahead of — the files that make it usable.

The worker contract (`dataDir` passed to sherpa, lexicons, rule FSTs) is unchanged.

## Alternatives considered

- Mark Kokoro as English-only in the UI: rejected as the fix for the report. The model is the application's only local speech path on Windows and Linux, translates its Chinese input normally, and the gap was a missing dictionary rather than an unsupported language.
- Fetch the whole upstream `espeak-ng-data` tree (30+ language families, dozens of dictionaries, several MB): rejected because every extra file is downloaded weight and another checksummed artifact to keep correct. `en*` plus `cmn`/`sit` covers the languages the adapter validates (`zh-CN`, `en-US`, `en-GB`), and an unsupported voice still fails loudly rather than silently mispronouncing.
- Download files concurrently without a declared order: rejected because progress, resumption and "is it installed" all read one ordered list; racing arbitrary files would make a cancelled 300MB download capable of leaving the model `ready` with a missing lexicon.
- Detect the `espeak_data_dir` defect at runtime and fail the request instead of exiting: not available in the shipped espeak-ng build, which exits from inside `espeak_Initialize`. Ordering the frontend ahead of the weights is what keeps an incomplete install from ever reaching that call.
- Bump sherpa-onnx or ship a patched espeak-ng: deferred. `espeak-ng-data` resolution is unchanged in the 1.13.8 runtime, and rebuilding native speech runtimes is a separate decision from a broken download list.

## Consequences

Chinese and mixed Chinese-English Kokoro synthesis work on every platform the bundle supports, and the first English word inside a Chinese reply no longer kills the worker. The bundle gains two files (~1.5MB). Downloads of Kokoro now write the lexicons first and `model.onnx` second-to-last, so the progress bar reaches ~40% before the largest file starts and an interrupted download resumes where it stopped.

Any future file added to the Kokoro bundle must be placed in `KOKORO_ORDER` in `src/main/ai/localModel/catalog/catalog.ts`; an unlisted path throws at module load instead of sorting silently to the end. The root cause of the `/usr/share/espeak-ng-data` fallback is not asserted here: the fix no longer depends on which of the contributing paths accepted the data directory, but the full explanation needs a build of the same espeak-ng commit, which this change did not produce.

## Verification

- Regression — `pnpm test:main src/main/ai/localModel/catalog/__tests__/catalog.test.ts`: asserts the Kokoro bundle ships `espeak-ng-data/lang/sit/cmn`, `espeak-ng-data/cmn_dict` and `espeak-ng-data/lang/gmw/en-US`, that `model.onnx`/`voices.bin` come last in every bundle that has weights, and that `parallelFetchFrom` points at an independent file before the weights.
- Regression — `pnpm test:main src/main/ai/localModel/acquisition/__tests__/bundleDownload.test.ts`: asserts the files marked independent are fetched concurrently and that `model.onnx` is not requested until they finish.
- Manual — no Windows machine with the packaged runtime was available in this change; the `espeak_ng_InitializePath` rejection described above was traced through the espeak-ng source pinned by sherpa-onnx 1.13.6 and the shipped 1.13.8 Windows build, not reproduced under the Electron utility process.

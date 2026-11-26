# Agent Note: Preserve Pi nested artifact declarations

Status: implemented

English | [中文](2026-11-12-pi-nested-artifact-declarations.zh.md)

## Problem

When a Pi codemode script calls the built-in artifact declaration tool, the outer script output may contain only a receipt. Artifact cards require the declaration's structured arguments. Pi already retains bounded nested-call evidence in native history, but the runtime projection discarded it.

## Decision

The Pi runtime adapter preserves native `nestedCalls` alongside the outer tool result, including error results and file-backed history. Desktop message decoration materializes successful built-in `cherry-tools/report_artifacts` declarations as ordinary artifact tool parts, using their native call identities and schema-validated arguments. A declaration has no required output payload; its projected output is null rather than an invented tool receipt.

Only successful records with complete, valid arguments qualify. A later failure in the enclosing script does not undo an already successful declaration. Repeated decoration does not duplicate call identities. Unrelated servers and tools remain unchanged.

## Alternatives considered

- Parsing console output loses typed arguments and mistakes arbitrary text for execution evidence.
- Advertising the tool directly does not prevent calls through codemode.
- Reconstructing all nested tool outputs invents information absent from Pi's bounded record.

## Consequences

Existing artifact cards and the right pane consume the same declaration contract for direct and nested calls. Native history remains authoritative; no schema migration or renderer-specific recovery is added. A bounded record with omitted arguments cannot produce a card. Historical product messages that lack native evidence are not repaired by parsing their text. This fix covers ordinary Pi, not Pi Durable.

## Verification

- Regression — `src/main/ai/runtime/pi/piNativeTools.test.ts`: real Pi, MCP transport and QuickJS produce a structured built-in artifact declaration; similarly named external tools do not.
- Regression — `src/main/ai/runtime/pi/PiMessageMetadata.test.ts`: success survives an outer script failure; failed, unfinished, truncated and invalid declarations are excluded; repeated decoration stays unique.
- Regression — `packages/agent-runtime-pi/tests/runtime.test.ts`: nested-call arguments and status survive live observation, archive projection and native file reopen, including outer errors.

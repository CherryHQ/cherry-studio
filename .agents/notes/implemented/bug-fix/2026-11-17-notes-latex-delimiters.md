# Agent Note: Preserve LaTeX delimiters in Notes

Status: implemented

English | Chinese counterpart: 2026-11-17-notes-latex-delimiters.zh.md

## Problem

Notes parses Markdown through TipTap's native Markdown extension. Its mathematics extension recognized dollar delimiters but did not recognize `\[...\]` or `\(...\)`, so existing notes displayed those formulas as raw text while chat rendered them correctly.

## Decision

Extend the existing block and inline math tokenizers to recognize bracket-delimited display math and parenthesis-delimited inline math. Keep dollar-delimited behavior and serialization unchanged.

## Alternatives considered

- Preprocess note strings into dollar delimiters: duplicates delimiter parsing outside the Markdown tokenizer and risks changing literal text or code.
- Replace the Notes parser with the chat Markdown pipeline: changes a broader editor contract and would require translating the full rich-editor schema.

## Consequences

Notes accepts the four LaTeX delimiter forms supported by the chat renderer without rewriting stored files. Serialization continues to use the existing dollar form.

## Verification

- Regression — `src/renderer/components/RichEditor/__tests__/nativeMarkdown.test.ts`: verifies bracket display and parenthesis inline delimiters parse as math nodes; existing tests cover dollar inline and display delimiters.

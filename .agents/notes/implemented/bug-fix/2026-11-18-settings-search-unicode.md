# Agent Note: Unicode equivalence in settings search

Status: implemented

English | [中文](2026-11-18-settings-search-unicode.zh.md)

## Problem

Settings search used lowercase conversion plus NFC. Equivalent input could miss settings: German ss versus ß, Greek sigma forms, East Asian width variants, and unaccented queries for accented labels. Korean catalogs also lacked search regression coverage.

## Decision

Apply the relevant default matching guidance from [W3C String Searching](https://www.w3.org/TR/string-search/) §§2.2.2–2.2.6, 2.2.9 and 2.2.10. This is a Group Note Draft, not a complete conformance standard. Use unicode-case-folding for default full case folding, normalize only the halfwidth/fullwidth block with NFKC, and compose canonical equivalents with NFC. Ignore supplementary ideographic variation selectors following unified ideographs. Remove combining diacritic marks from candidate text only when the normalized query has no such marks. Keep the existing whitespace-insensitive fallback, ranking, pinyin matching and English source lookup.

## Alternatives considered

- Lowercasing misses full case-fold expansions; handwritten mappings would duplicate Unicode maintenance.
- Whole-string NFKC also conflates unrelated compatibility forms such as circled numbers.
- Unconditional accent removal discards explicitly entered distinctions. Removing every combining mark also erases meaningful script components.

## Consequences

Displayed labels remain unchanged. Korean composed and decomposed syllables match without conflating distinct syllables. The renderer bundles one small dependency. Settings search remains a forgiving substring finder; it does not add sensitivity controls, language-specific casing, digit transliteration, spelling synonyms, whole-word matching or Korean initial-consonant matching. These are separate product choices, not claims of complete draft implementation.

## Verification

- Regression — searchEngine.test.ts covers full folding, width variants, Korean canonical equivalence, whitespace, asymmetric accents, ideographic variants and negative distinctions.
- Regression — settingsSearchIndex.test.ts finds Korean language, proxy and startup controls from real catalogs, including English proxy lookup.
- Regression — 98 tests pass across searchEngine.test.ts, settingsSearchIndex.test.ts and SettingsSearchBox.test.tsx.

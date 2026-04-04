# Document Review Checklist

Review in priority order: A (highest impact) → B → C. The reviewer prompt specifies
which levels to check. Project rules loaded in context override this checklist.

---

## A. Accuracy

Issues where the document contains incorrect, contradictory, or incomplete information.

### A1. Code-Document Accuracy
- Described behaviors match actual code implementation
- Parameter names, types, default values consistent with code
- Return values and error conditions accurately documented
- Described algorithms / processing steps consistent with implementation
- Version numbers, format identifiers, constants correct
- Value ranges and constraints accurate
- Enum values and meanings consistent with code definitions
- IPC channel names and payload types match IpcChannel.ts definitions

### A2. Internal Consistency
- Different sections describing the same concept agree with each other
- Constraints and rules consistent across the document (no contradictions like
  "must be >= 0" in one section with a negative default in another)
- Same rule appearing in multiple places identical in meaning

### A3. Completeness
- All public APIs / features documented
- Newly added features or parameters reflected in the document
- Removed or deprecated features marked accordingly
- Edge cases and limitations documented
- All conditional branches exhaustively covered (no undocumented "else" cases)
- Sequential steps complete with no missing intermediate steps
- Undefined behaviors identified (input combinations with no documented result)

### A4. Reference Validity
> Do not attempt to verify URL reachability.
- Internal cross-references point to existing sections or files
- External links / URLs well-formed and not obviously outdated
- Referenced file paths, tool names, command examples actually exist

---

## B. Clarity & Structure

Improvements to readability, unambiguity, and organization.

### B1. Ambiguity Detection
- No descriptions interpretable in multiple ways
- Conditional statements precise ("should" vs "must", "may" vs "will")
- Boundary conditions clearly stated (inclusive vs exclusive, "at least" vs "exactly")

### B2. Simplification
> Only flag when the same information is stated more than once in different sections.
- Redundant paragraphs or sections repeating the same information consolidated

### B3. Logical Flow
- Information presented in logical order
- Related topics grouped together
- Forward references minimized

### B4. Examples & Illustrations
- Existing examples correct and consistent with described behavior

### B5. Terminology Consistency
- Terms used consistently throughout the document
- Terms match codebase usage (class names, function names, enum values)
- Abbreviations defined on first use

---

## C. Formatting & Style

Polish and stylistic consistency.

### C1. Formatting Consistency
- Headings, lists, tables formatted consistently
- Code snippets properly formatted and syntax-highlighted

### C2. Grammar & Wording
- No grammatical errors or awkward phrasing
- Writing style consistent throughout
- Tone appropriate for target audience

### C3. Section Organization
- Sections appropriately sized (not too long or too short)
- Table of contents (if present) consistent with actual sections
- Deprecated or obsolete sections cleaned up

---

## Exclusion List

> Project rules override this exclusion list.

1. Pure formatting preferences not affecting readability
2. Stylistic rewrites that don't improve clarity or accuracy
3. Suggestions based on assumed future requirements, not current content
4. Suggestions to add content beyond the document's stated scope
5. Removing default or verbose attributes from examples — examples in specs and
   tutorials are intentionally detailed to demonstrate available options

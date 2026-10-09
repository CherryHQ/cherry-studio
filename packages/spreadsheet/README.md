# Shared spreadsheet I/O

Internal, source-only workspace package for ExcelJS workbook I/O in Node and browser workers.
The document converter and file preview bundle this package into their own outputs; it is not
published separately and has no React or Electron dependency.

- `createWorkbook()` creates an editable workbook.
- `readWorkbook(data)` preserves workbook structures for normal reads.
- `readWorkbookForPreview(data)` skips merge, validation and defined-name expansion. The preview
  reads merge ranges from the ZIP separately. Do not use this mode for document round trips.
- `writeWorkbook(workbook)` returns an owned `Uint8Array` in Node and browsers.

Sheet naming, formatting and preview rendering remain with their consumers. ExcelJS is declared
only here. Public workbook/cell types allow consumers to use the same workbook model.

Regression coverage lives in the document-conversion tests and the file-preview spreadsheet
parser tests. Both consumers typecheck this source through the package export.

# @cherrystudio/file-preview

## 0.2.1

### Patch Changes

- [#20897](https://github.com/CherryHQ/cherry-studio/pull/20897) [`9e64ff8`](https://github.com/CherryHQ/cherry-studio/commit/9e64ff899b6ec4cb5b6a765baa0ba42fb325596e) Thanks [@ousugo](https://github.com/ousugo)! - Preserve valid reading state when refreshing the same document, while replacing its source session and rejecting obsolete selection and failure callbacks.

## 0.2.0

### Minor Changes

- [#22376](https://github.com/CherryHQ/cherry-studio/pull/22376) [`3d75b7a`](https://github.com/CherryHQ/cherry-studio/commit/3d75b7a0ac6078f0821ebba7ce88a6af8835665f) Thanks [@DeJeune](https://github.com/DeJeune)! - Add read-only RTF previews with formatted text, Unicode and legacy code pages, embedded images, safe links, and a 10 MiB source limit.

## 0.1.3

### Patch Changes

- [#22031](https://github.com/CherryHQ/cherry-studio/pull/22031) [`0041d52`](https://github.com/CherryHQ/cherry-studio/commit/0041d522ff6856036ef008255c451d3291e4ac7d) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - DOCX preview now honours the OOXML default lineRule (auto) when w:spacing omits it.

## 0.1.2

### Patch Changes

- [#19894](https://github.com/CherryHQ/cherry-studio/pull/19894) [`ff3a9c6`](https://github.com/CherryHQ/cherry-studio/commit/ff3a9c6beabd1e9613e0a6f77e217207578d409b) Thanks [@SiinXu](https://github.com/SiinXu)! - Show a PowerPoint-specific fallback when a PPTX archive exceeds the previewer's ZIP safety limits. This is separate from files whose compressed source is larger than 25 MiB, and it reuses the existing external-open action.

## 0.1.1

### Patch Changes

- [#21534](https://github.com/CherryHQ/cherry-studio/pull/21534) [`3d389c5`](https://github.com/CherryHQ/cherry-studio/commit/3d389c5dfaa2fe68773cb6aed9f925f2263dce33) Thanks [@SiinXu](https://github.com/SiinXu)! - Keep SVG file previews sharp when zooming without changing their initial size.

## 0.1.0

### Minor Changes

- [#21407](https://github.com/CherryHQ/cherry-studio/pull/21407) [`555f219`](https://github.com/CherryHQ/cherry-studio/commit/555f219cea1531d0a40f72c4bdc405dec86bddf6) Thanks [@zhangjiadi225](https://github.com/zhangjiadi225)! - Publish the portable React document preview package for PDF, DOCX, PPTX, XLSX and images.
  The package includes rendering controls, scoped styles, workers, PDF resources and
  translations, with host-provided document access and selection/error callbacks.
  Consumers can import the `core`, `react`, `styles.css` and `assets/*` entry points
  without depending on the Cherry Studio workspace or applying dependency patches.

# Original Image Save-As Design

## Problem

ImageViewer currently converts every image to PNG before Save As. This changes the file format and can re-encode or reduce the usefulness of the original high-resolution output, even when the user made no pixel transform.

## Scope

- Save the original Blob bytes when rotation and flips are unchanged.
- Preserve the source image format in the suggested filename.
- Keep transformed output as PNG because rotation and flips require rasterization.
- Leave clipboard copy and paste behavior unchanged.

## Design

The renderer already resolves every supported source into a Blob with `getImageBlobFromSource`, and the preload already exposes `window.api.file.save` for binary `ArrayBufferView` content. ImageViewer will use those existing boundaries directly; no new IPC route, main-process service, or persistent state is needed.

For an untouched image, ImageViewer obtains the Blob, derives an extension from its MIME type, converts only the Blob container to a `Uint8Array`, and passes those exact bytes to the save dialog. There is no decode, canvas draw, PNG conversion, or quality setting. If the MIME type is absent, the code falls back to a recognized extension from the source name or URL, then to `.bin` rather than claiming a false image format.

If rotation, horizontal flip, or vertical flip is active, ImageViewer continues to call `transformImageToPng`. It saves the transformed Blob bytes with a `.png` filename. Zoom and offsets remain view-only and are not baked into either path.

## Performance

The untouched path removes PNG decoding/re-encoding and one base64 data-URL conversion. It allocates one `ArrayBuffer`/`Uint8Array` for IPC serialization, which is necessary to save binary data and is bounded by the source size. The clipboard path is not touched, so this PR adds no clipboard memory or latency cost.

## Verification

Renderer tests must prove that a WebP source is saved with a `.webp` name and byte-for-byte source content, and that a flipped/rotated source is saved as the transformed PNG bytes. Existing clipboard tests must remain unchanged and pass.


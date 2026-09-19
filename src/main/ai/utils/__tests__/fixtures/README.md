# HDR image edit fixtures

These synthetic photos contain no user data. Both contain a real JPEG HDR gain map and a 32 × 24 primary image. `hdr-rotated.jpg` also has EXIF orientation 6 (90° clockwise).

Generated with the repository's sharp 0.35.3 runtime:

```javascript
const hdr = await sharp({
  create: { width: 32, height: 24, channels: 3, background: '#c85020' }
}).withGainMap().jpeg().toBuffer()
await fs.writeFile('hdr.jpg', hdr)
await sharp(hdr).keepGainMap().withMetadata({ orientation: 6 }).jpeg().toFile('hdr-rotated.jpg')
```

The experimental gain-map encoders are available at runtime but absent from this version's TypeScript declarations. Tests decode these fixtures using the typed API and verify the actual upload bytes.

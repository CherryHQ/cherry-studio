# Synthetic HEIF test assets

Original 96 × 64 RGBA artwork authored by this automation, licensed AGPL-3.0-only; no third-party artwork. Quadrants are red (220,30,40), green (30,160,60), blue (40,60,200), white (245,245,245), with an 8 × 8 black marker at (8,8). HEVC is lossy; pixel checks allow ±12 per channel.

From this directory, run `node generate.cjs`. It generates the artwork then invokes:

```sh
sips -s format heic quadrants.png --out quadrants.heic
```

The generator stages all outputs in a temporary directory, fails loudly if sips is unavailable, and cleans up partial generation. PNG output is byte-reproducible with sharp 0.35.3. The orchestrator ran sips outside the sandbox because the sandbox denies the per-user temporary directory used internally by sips. Observed versions: macOS 27.0.1 (26A434), sips-316 (`sw_vers`, `sips --version`).

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `quadrants.png` | 389 | `4d000ad2613a1c0c495c7ca975cb820b2cd17a1aa603251fa34f356a40876367` |
| `quadrants.heic` | 674 | `e0a87a4a4a2779fed3374ea72b57592e2628149d6754aeab30545afe48dec401` |
| `quadrants-truncated.heic` | 100 | `dd76867f15a8b2b28b440a93ea76afa4b6274d48fb31dbe2cc4cbee7835b79ed` |
| `not-heif.heic` | 389 | `4d000ad2613a1c0c495c7ca975cb820b2cd17a1aa603251fa34f356a40876367` |

The truncated fixture is the first 100 HEIC bytes. The mislabeled fixture is the PNG with a HEIC suffix. These fixtures do not establish rotation, mirroring, alpha or multiple-image-container correctness.

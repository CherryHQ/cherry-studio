import { readFile, writeFile } from 'node:fs/promises'

import {
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  OggOutputFormat,
  Output,
  WEBM
} from 'mediabunny'

const media = new Input({
  source: new BufferSource(await readFile(new URL('./media-recorder-opus.webm', import.meta.url))),
  formats: [WEBM]
})
try {
  const [track] = await media.getAudioTracks()
  const decoderConfig = await track.getDecoderConfig()
  const target = new BufferTarget()
  const output = new Output({ format: new OggOutputFormat(), target })
  const source = new EncodedAudioPacketSource('opus')
  output.addAudioTrack(source)
  await output.start()
  let timestamp = 0
  for await (const packet of new EncodedPacketSink(track).packets()) {
    await source.add(packet.clone({ timestamp }), { decoderConfig })
    timestamp += packet.duration
  }
  await output.finalize()
  await writeFile(new URL('./media-recorder-opus.ogg', import.meta.url), new Uint8Array(target.buffer))
} finally {
  media.dispose()
}

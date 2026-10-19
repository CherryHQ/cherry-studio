---
"@cherrystudio/remote-transport": patch
---

Apply backpressure when a remote socket's queued bytes reach the cap instead of aborting the stream; the stream waits for the buffer to drain and aborts only if it stays congested past the idle timeout.

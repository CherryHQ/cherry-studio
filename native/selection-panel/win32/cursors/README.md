# Windows drag cursors

`hand_grab.cur` and `hand_grabbing.cur` are Chromium's Windows grab and grabbing
cursors from revision `7ec6f760e933304dbf10063afb9334f3496ae44c`:

- https://chromium.googlesource.com/chromium/src/+/7ec6f760e933304dbf10063afb9334f3496ae44c/ui/resources/cursors/hand_grab.cur
- https://chromium.googlesource.com/chromium/src/+/7ec6f760e933304dbf10063afb9334f3496ae44c/ui/resources/cursors/hand_grabbing.cur

They retain Chromium's BSD license in [LICENSE](LICENSE). The Windows addon embeds
them as cursor resources because Windows has no system grab/grabbing cursors.
The build copies the license beside the addon as `selection-panel-license.txt`.

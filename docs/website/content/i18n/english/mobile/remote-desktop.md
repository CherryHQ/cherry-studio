---
icon: monitor
---

# View and control a remote desktop

Remote desktop opens the computer's screen and controls through **UU Remote**. Cherry Studio stores the association and launches it; UU owns the actual connection, screen, and controls. This differs from sending text tasks to a [desktop agent](remote-chat.md).

## Requirements

* Install **UU Remote 4.42.0 or later** on the phone and configure it on the target computer.
* [Pair the computer](desktop-sync.md) in Cherry Studio and select it from the sidebar's device picker.
* Picture in picture on iPhone/iPad additionally requires **iOS/iPadOS 18 or later** and supported hardware. Where unavailable, an explicit full-screen alternative can be offered.

Cherry Studio can check whether UU can open, but cannot verify its installed version. Check that in UU.

## Associate and open

1. Choose **Remote desktop** from the selected computer's device menu.
2. Follow the UU flow and select the Windows/macOS device corresponding to that Cherry Studio computer.
3. Finish association and establish the connection in UU. Subsequent use can open picture in picture from the same entry.
4. Confirm full-screen launch when offered. Switch back to Cherry Studio manually afterward.

You must verify the computer selected in UU. A saved association identifier does not prove it is the same physical computer paired in Cherry Studio. Reassociate through **Settings → Device connections → target device** if necessary.

## Picture in picture is unavailable

Check UU installation/version and phone OS/hardware support, then explicitly choose full screen or cancel. Cancellation is not consent to launch full screen.

**Launching UU does not establish a successful remote-control connection.** Check accounts, network, online state, and actual control permissions in UU. Removing a Cherry Studio pairing does not revoke UU's separate remote-control authorization.

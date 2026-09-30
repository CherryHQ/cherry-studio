# Device connection setup

`DeviceConnectionSetupService` owns on-demand VPN checks and Tailscale installation
shared by the settings IPC handlers and Agent connection tools. Concurrent calls reuse
the in-flight task; service shutdown aborts and drains it. Closing the settings dialog
does not cancel installation.

`vpnStatus.ts` is private to this module. It reads local Tailscale / ZeroTier state and
returns only this computer's usable addresses. `BinaryManager` executes the official-source
system package installation; unsupported platforms and installation failures return manual guidance.

The public entry is `index.ts`; the repository's barrel lint rule forbids external deep imports.
The service is registered in the lifecycle container and consumers resolve it through `application.get()`.

Gateway listeners, pairing, authenticated sessions and device-bound address queries remain
with API Gateway and RemoteAccessService. They do not depend on VPN detection or setup;
any reachable network can carry a connection. Installer success does not verify VPN login
or phone connectivity.

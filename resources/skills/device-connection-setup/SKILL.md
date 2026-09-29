---
name: device-connection-setup
description: Help connect Cherry Studio mobile to an existing paired computer across local, company or VPN networks. Check device connection settings, reuse existing VPN clients, and guide Tailscale installation only when needed.
version: 1.0.0
---

# Device connection setup

Use the live `device_connection_check` and `device_connection_install` Cherry tools.
The deterministic Device Connections settings page remains usable without a model.

1. Check the gateway and connection addresses. If disabled, direct the user to API Gateway
   settings and then Allow device connections. Never write preferences or start a second server.
2. If the current network works, pair once using the desktop QR and approval. No VPN is needed.
   Any routed private network may work; recognizing a VPN brand is not required.
3. For another network, reuse installed clients. Unknown status is not proof of absence.
   Do not replace an existing App Store, standalone or CLI installation. ZeroTier networks
   awaiting approval require their administrator; Cherry pairing cannot grant network access.
4. Only when the user wants a new cross-network path, explain the Tailscale install operation
   and invoke `device_connection_install` once. Its approval covers the operation. The tool
   uses bundled mise where supported and otherwise returns the official installation page.
   System permission and account login must be completed by the user. Do not run alternate
   shell installers, collect passwords, enable exit nodes, Serve/Funnel or change firewalls.
5. Have the user install the official mobile client and join an authorized network. Recheck.
6. On the already paired phone, open the computer's connection settings, get its addresses,
   select the desired address and use Save and verify. This tests only that address, the pinned
   identity and an authorized read before saving. Ordinary QR scans remain temporary hints.
7. Report current-network verification separately from testing on another network. VPN ready
   and installer success do not prove phone connectivity. Preserve pairing and grants on failure.

Official references: https://tailscale.com/download and https://docs.zerotier.com/cli/.
Never include pairing secrets, VPN credentials, other peer inventories or login tokens in chat.

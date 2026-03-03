# Custom Brand Assets Directory

This directory is used for storing custom brand assets when building a customized version of Cherry Studio.

## ⚠️ AGPL-3.0 License Compliance

**Cherry Studio is licensed under AGPL-3.0.** When creating a custom branded version, you MUST:

1. **Provide source code** to all users of your modified version
2. **Preserve all copyright notices** attributing Cherry Studio
3. **Include AGPL-3.0 license information** in your application
4. **Display attribution** stating your software is based on Cherry Studio
5. **License your modifications** under AGPL-3.0

See [docs/AGPL_COMPLIANCE.md](../docs/AGPL_COMPLIANCE.md) for detailed requirements.

## Directory Purpose

When using a custom brand profile (configured in `brand.config.json`), the build process will look for brand assets in this directory.

## Required Assets

For a complete custom branding, provide the following assets:

- `icon.png` - Application icon (512x512px recommended)
- `logo.png` - Application logo (used in UI)
- `tray_icon.png` - System tray icon (16x16px or 32x32px)
- `tray_icon_dark.png` - Dark mode tray icon
- `tray_icon_light.png` - Light mode tray icon

## Usage

1. Place your custom assets in this directory with the filenames listed above
2. Configure your custom brand profile in `brand.config.json` with proper AGPL compliance:
   - Set `sourceCodeUrl` to your public repository
   - Set `copyrightNotice` with proper attribution
3. Set the `assets` paths to point to `brand-custom/` directory
4. Build with: `pnpm run build:custom`

## Example Configuration

```json
{
  "custom": {
    "name": "Your Brand Name",
    ...
    "license": {
      "type": "AGPL-3.0",
      "sourceCodeUrl": "https://github.com/yourcompany/your-cherry-studio-fork",
      "copyrightNotice": "Based on Cherry Studio (https://github.com/CherryHQ/cherry-studio) - Copyright (C) CherryHQ. Modified by Your Company.",
      "showOriginalAttribution": true
    },
    "assets": {
      "icon": "brand-custom/icon.png",
      "logo": "brand-custom/logo.png",
      "trayIcon": "brand-custom/tray_icon.png",
      "trayIconDark": "brand-custom/tray_icon_dark.png",
      "trayIconLight": "brand-custom/tray_icon_light.png"
    }
  }
}
```

## Note

If assets are not provided, the default Cherry Studio assets will be used. However, ALL AGPL-3.0 compliance requirements still apply regardless of whether you use custom assets.

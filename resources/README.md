# resources/

Master images for app icon + splash screen, used by `@capacitor/assets`
to generate all platform-specific sizes during native build.

## Files

| File | Used by | Notes |
|---|---|---|
| `icon.png` | `@capacitor/assets generate` | 1024×1024 master icon, RGB (no alpha). Apple App Store uploads use this exact size. The "M / مشوارو" gold mark on solid forest green (#1a3d2a). |
| `icon-only.png` | iOS 18 light/dark/tinted icon variants | Same as `icon.png` for now — capacitor-assets uses it as the foreground when generating tinted variants. |
| `icon-foreground.png` | iOS 18 dark + tinted variants | Just the gold mark on transparent background. iOS dynamically tints this for tinted dark mode. |
| `icon-background.png` | iOS 18 background layer | Solid #1a3d2a fill. iOS 18 composites foreground over this for various icon styles. |
| `splash.png` | Splash screen on app cold-boot | 2732×2732 master. Full marketing logo (with tagline) centered on green. capacitor-assets generates all phone + iPad sizes from this. |
| `splash-dark.png` | Dark mode splash (iOS 13+) | Identical to `splash.png` because the brand background is already dark. |

## How to regenerate all platform sizes

On your Mac after pulling the repo:

```bash
npm install --save-dev @capacitor/assets
npx capacitor-assets generate --ios --android
```

This produces:
- **iOS:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/` — every required icon size (Apple's 30+ sizes from 20×20@1x to 1024×1024)
- **iOS splash:** `ios/App/App/Assets.xcassets/Splash.imageset/` — splash images for every iPhone + iPad size
- **Android:** `android/app/src/main/res/mipmap-*` — every Android density bucket (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi)
- **Android splash:** `android/app/src/main/res/drawable-*` — every density splash

Then in Xcode the icons appear automatically (if Xcode was open during
generation, you may need to close and reopen).

## To regenerate the master images

The Python script that builds these is intentionally not committed —
the masters are stable artifacts. If you ever need to rebuild from a
new logo source:

```python
# Open the original full-marketing logo at public/logo.png
from PIL import Image
import numpy as np

src = Image.open('public/logo.png').convert('RGB')
arr = np.array(src)
BG = (26, 61, 42)  # forest green

# Extract gold mark (warm pixels): R > 150, G > 100, R > B + 50
r, g, b = arr[:,:,0].astype(np.int16), arr[:,:,1].astype(np.int16), arr[:,:,2].astype(np.int16)
is_gold = (r > 150) & (g > 100) & (r > b + 50) & (g > b + 30)
mark = np.zeros((arr.shape[0], arr.shape[1], 4), dtype=np.uint8)
mark[:, :, :3] = arr
mark[is_gold, 3] = 255

# Crop to bbox, center on solid bg, resize to 1024 / 2732
# (See git history for the full script)
```

## Color reference

| Color | Hex | Where used |
|---|---|---|
| Forest green | `#1a3d2a` | App icon background, splash, status bar |
| Gold | `#c9a227` | Brand accents (not directly in icon) |
| Cream | `#faf5e6` | App body background (NOT icon — icon uses dark green) |

## ⚠️ Things that would break the icon

- **Adding alpha/transparency to `icon.png`** — App Store rejects icons with transparency. The 1024 master must be RGB.
- **Adding rounded corners to `icon.png`** — Apple applies the system mask. Custom rounded corners create double-rounding artifacts.
- **Text smaller than 50px on the 1024 canvas** — illegible at 60×60 home-screen size, may be cited under HIG icon guidelines.
- **High-detail photographs** — Apple icon guidance favors simple, bold marks readable at 20×20.

The current design (gold M + مشوارو wordmark on solid green) follows
all of these rules.

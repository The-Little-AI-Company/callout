# Assets

Art is produced by Jeff with ChatGPT's image generation. The build
ships placeholders (`src/assets/placeholder-*.svg`, a flat gray skull-and-ears
silhouette) until each file lands at the path below. Drop the real file in
place with the same name; no code change is needed.

Mascot prompt to start from (PRD 10c, HANDOFF):

> A small cartoon skull with tall rabbit ears, eyes drawn as two flat horizontal
> lines, sly closed-mouth expression. Wears a plain black T-shirt with 'EAT THE
> RICH' in white block letters. Holds a small green robot plushy in both arms:
> round head, huge round eyes, wide unhinged grin, floppy dog-suit hood with
> ears, a clear homage to a certain cartoon robot but an original design. Flat
> vector style, thick outlines, limited palette, transparent background.

| File | Path | Size and format | Used in | Generation prompt |
|---|---|---|---|---|
| `mascot-full.png` | `src/assets/mascot-full.png`, `site/assets/mascot-full.png` | 2048 px tall, transparent PNG | landing page hero, settings page | Base prompt, full body, standing, three-quarter view. |
| `mascot-tray-16.ico` | `src-tauri/icons/tray-16.ico` | 16 by 16, ICO, light and dark variants (`tray-16-dark.ico`) | tray icon | "Skull with tall rabbit ears as a flat silhouette, single color, readable at 16 pixels, no shirt, no plushy, transparent background." Light variant white, dark variant near-black. |
| `mascot-tray-32.ico` | `src-tauri/icons/tray-32.ico` | 32 by 32, ICO, light and dark variants | tray icon, high DPI | Same as 16 px. |
| `mascot-empty.png` | `src/assets/mascot-empty.png` | 512 px, transparent PNG | popover empty state | Base prompt, "holding the plushy up with both arms, waiting, ears slightly forward." |
| `mascot-loading.png` | `src/assets/mascot-loading.png` | 512 px, transparent PNG | deep-lane loading | Base prompt, "sniffing the air with eyes squinted to thin lines, plushy tucked under one arm." |
| `mascot-error.png` | `src/assets/mascot-error.png` | 512 px, transparent PNG | error states | Base prompt, "shrugging with both palms up, plushy dropped on the ground beside it, still grinning." |
| `mascot-unsure.png` | `src/assets/mascot-unsure.png` | 512 px, transparent PNG | all-gray results | Base prompt, "tilting its head with a small question mark floating above, plushy peeking over its shoulder." |
| `app-icon-256.png` | `src-tauri/icons/icon.png` (also `icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png` via `npm run tauri icon`) | 256 by 256 square, flat, readable at 32 px | installer, taskbar, window | "Flat square app icon: skull with tall rabbit ears centered on a solid dark background, two-line eyes, thick outlines, no text." |
| `og-image.png` | `site/assets/og-image.png` | 1200 by 630 PNG | landing page share image | "Wide banner: the mascot at left holding the plushy, the word 'Callout' in a bold single-color wordmark at right, plain dark background, no other text." |
| `wordmark.svg` | `site/assets/wordmark.svg`, `src/assets/wordmark.svg` | SVG, single color | site header, about page, settings | "The word 'Callout' as a bold, slightly rounded wordmark, one color, no icon." Export as SVG paths. |

Rules from the PRD that apply to every asset:

- The plushy is an homage, not a copy. No GIR name, no Invader Zim marks, no
  exact GIR design anywhere in the product, site, or store listing.
- The mascot never appears next to a verdict row, the evidence view, or the
  confidence band.
- The "eat the rich" shirt stays.

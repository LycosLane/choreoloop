# ChoreoLoop Brand Guidelines

## Core Identity

ChoreoLoop uses the White Fedora with A-B Loop Motif as its official mark. Adapted from the FreeDataDiet and MusicHeist brand system, the symbol represents transparent, zero-bloat open source software tailored for dancers and choreography practice. It pairs a high-contrast white crown and brim with a modular two-tone ribbon and clean geometric loop vectors.

The mark is identical across all platforms: iOS home screen PWA, Android adaptive web app, and desktop browser.

## Logo Geometry

The logo is built from pure flat geometric vector shapes:
- **Angle**: A dynamic -6 degree upward tilt on the White Fedora.
- **Crown**: Crisp white silhouette with a negative-space V-pinch at the top.
- **Negative Space Gap**: A clean horizontal cut separating the crown from the ribbon, showing the background directly.
- **Modular Ribbon**: Two color blocks separated by negative space:
  - Left segment (Cyan `#00B4FF`): Links ChoreoLoop to the FreeDataDiet/MusicHeist software suite and represents Point A / playback flow.
  - Right segment (Rose `#F43F5E`): Symbolizes Point B, choreography energy, and movement.
- **Brim**: Bold, sweeping white curve running across the base of the mark.
- **Loop Motif**: Flat geometric loop arcs or A-B directional vectors framing the fedora with clean negative-space separation.

## Color Palette

### Primary Brand Colors

| Swatch | Name | Hex | RGB | Usage |
|---|---|---|---|---|
| Obsidian Dark | Dark Background | `#101216` | `16, 18, 22` | Dark mode background, icon background |
| Crisp Light | Light Background | `#F8FAFC` | `248, 250, 252` | Light mode background |
| Pure White | Mark White | `#FFFFFF` | `255, 255, 255` | Hat crown, brim, high-contrast dark mode text |
| Brand Cyan | Suite Cyan | `#00B4FF` | `0, 180, 255` | Primary highlight, Point A, active controls, left ribbon |
| Brand Rose | Choreo Rose | `#F43F5E` | `244, 63, 94` | Secondary highlight, Point B, delete actions, right ribbon |
| Loop Mint | Active Mint | `#10B981` | `16, 185, 129` | Active Loop On state indicator |

### Surface and UI Hierarchy

#### Dark Theme (Default Studio Mode)
- Scaffold Background: `#101216`
- Surface / App Bar: `#171A21`
- Card / Container: `#1E222B`
- Border / Divider: `#2B313E`
- Primary Text: `#ECEFF4`
- Secondary Text: `#94A3B8`

#### Light Theme (Bright Mode + Black Fedora)
- Scaffold Background: `#F8FAFC`
- Surface / App Bar: `#FFFFFF`
- Card / Container: `#F1F5F9`
- Border / Divider: `#E2E8F0`
- Primary Text: `#0F172A`
- Secondary Text: `#64748B`
- Deep Suite Cyan (WCAG contrast): `#0284C7`
- Deep Choreo Rose (WCAG contrast): `#E11D48`
- Deep Loop Mint (WCAG contrast): `#059669`

## Modular Ribbon System

The White Fedora mark serves as the universal anchor for the suite. Each application customizes the ribbon colors:

- **FreeDataDiet**: Cyan (`#00B4FF`) and Amber (`#FFB020`)
- **FreeWinly**: Windows Blue (`#0078D4`) and Cyan (`#00B4FF`)
- **Alltimer**: Deep Indigo (`#6366F1`) and Purple (`#A855F7`)
- **MusicHeist**: Cyan (`#00B4FF`) and Mint (`#10B981`)
- **ChoreoLoop**: Cyan (`#00B4FF`) and Rose (`#F43F5E`)

## Icon Specifications and Safe Zones

### PWA & Mobile Icons
- Canvas size: 512x512 viewBox.
- Maskable safe zone: Keep the fedora and loop motif centered within the inner 70% circle so no part of the brim or arrows is clipped by Android adaptive masks or iOS rounded corners.
- Background: Solid Obsidian `#101216`.

### Master Assets
- Vector Master: `public/icons/choreoloop.svg` (512x512 viewBox)
- Logo Concepts: `assets/icons/concepts/*.svg`
- PWA PNGs: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png`

## Usage Rules
- Do not add 3D bevels, glossy reflections, or drop shadows to the hat or loop vectors.
- Maintain the -6 degree slant on the White Fedora. Do not rotate arbitrarily.
- Keep the negative-space pinch, band gap, and motif separation transparent.

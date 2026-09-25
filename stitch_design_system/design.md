# AuralFlow Design System

## Overview
AuralFlow is a premium, AI-powered lossless music player. The app follows strict Apple-style fluid interface design principles. It feels less like a webpage and more like a native, physical application.

## Core Principles
- **Fluid & Interruptible:** All animations use spring physics. Interactions can be interrupted and reversed instantly.
- **Translucency & Materials:** Hierarchy is established through glassmorphism and background blur, not just flat colors.
- **High-End Typography:** Uses the Inter variable font with optical sizing, tight tracking on headings, and generous line-heights on body text.
- **Lossless Focus:** The UI prominently highlights high-resolution audio formats (Hi-Res Lossless, Dolby Atmos).

## Color Palette
The app is strictly dark mode to emphasize album art and the glowing background effects.
- **Background:** `#000000` (Pure Black)
- **Elevated Background (Cards):** `#1c1c1e` (Slightly lighter black/gray)
- **Glass Material:** `rgba(28, 28, 30, 0.7)` with `blur(40px) saturate(180%)`
- **Text Primary:** `#ffffff` (White)
- **Text Muted:** `#8e8e93` (Apple Gray)
- **Accent/Brand:** `#0a84ff` (Apple Blue)
- **Success:** `#32d74b` (Green)
- **Danger:** `#ff453a` (Red)
- **Borders/Dividers:** `#38383a` (Dark Gray)

## Quality Badges
Tags used to indicate track quality:
- **Hi-Res Lossless:** Purple background/border (`#a855f7`)
- **Lossless:** Emerald background/border (`#10b981`)
- **Dolby Atmos:** Blue background/border (`#3b82f6`)

## Typography
- **Font Family:** `Inter`, `-apple-system`, `system-ui`
- **Headings (H1/H2):** Bold (600-700), tight letter-spacing (`-0.02em`).
- **Body Text:** Regular/Medium (400-500), slightly open tracking (`-0.01em`), 15px base size.

## UI Components & Patterns

### 1. Glass Player Bar
- Positioned absolutely at the bottom of the screen.
- Background uses the standard glass material (blur and saturation).
- Contains the album art (with shadow), track info, playback controls, and a custom fluid progress bar.
- Play button is large, white, with a black icon. Other controls are muted and transition to white on hover.

### 2. Custom Progress Bar
- A thin white line on a translucent white track.
- The drag thumb is hidden by default and expands on hover/active.
- Must feel instantly responsive and scrub smoothly.

### 3. Dynamic Background
- The background of the app features the current track's album art scaled up by 150%, heavily blurred (`blur(100px)`), and saturated (`saturate(200%)`).
- Overlaid with a `black/40` backdrop blur to keep text legible.

### 4. Search Input
- Large, pill-shaped or heavily rounded (`rounded-2xl`).
- Glass material with subtle white borders.
- Border glows or becomes brighter on focus.

### 5. Track List (Queue & Search Results)
- Items highlight with a subtle white translucent background on hover (`hover:bg-white/10`).
- Album art has a small, tight shadow.
- Quality badges are aligned to the right or next to the title.

## Motion & Springs (Framer Motion)
- **Default Spring:** `type: "spring", stiffness: 200, damping: 25` (Smooth, critically damped).
- **List Items:** Staggered entrance, slightly bouncier (`stiffness: 300, damping: 25`).
- **Active States:** Buttons scale down to `0.95` on press.
- **Hover States:** Play button scales up to `1.05` on hover.

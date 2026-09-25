---
name: AuralFlow
colors:
  surface: '#121317'
  surface-dim: '#121317'
  surface-bright: '#38393d'
  surface-container-lowest: '#0d0e12'
  surface-container-low: '#1a1b1f'
  surface-container: '#1e1f23'
  surface-container-high: '#292a2e'
  surface-container-highest: '#343539'
  on-surface: '#e3e2e7'
  on-surface-variant: '#c0c6d6'
  inverse-surface: '#e3e2e7'
  inverse-on-surface: '#2f3034'
  outline: '#8b91a0'
  outline-variant: '#414754'
  surface-tint: '#aac7ff'
  primary: '#aac7ff'
  on-primary: '#003064'
  primary-container: '#3e90ff'
  on-primary-container: '#002957'
  inverse-primary: '#005db8'
  secondary: '#c8c6c8'
  on-secondary: '#303032'
  secondary-container: '#474649'
  on-secondary-container: '#b6b4b7'
  tertiary: '#ffb691'
  on-tertiary: '#552000'
  tertiary-container: '#eb6a12'
  on-tertiary-container: '#4a1b00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#aac7ff'
  on-primary-fixed: '#001b3e'
  on-primary-fixed-variant: '#00468d'
  secondary-fixed: '#e4e2e4'
  secondary-fixed-dim: '#c8c6c8'
  on-secondary-fixed: '#1b1b1d'
  on-secondary-fixed-variant: '#474649'
  tertiary-fixed: '#ffdbcb'
  tertiary-fixed-dim: '#ffb691'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#793100'
  background: '#121317'
  on-background: '#e3e2e7'
  surface-variant: '#343539'
  background-pure: '#000000'
  glass-surface: rgba(28, 28, 30, 0.7)
  hi-res: '#a855f7'
  lossless: '#10b981'
  dolby-atmos: '#3b82f6'
  success: '#32d74b'
  danger: '#ff453a'
  border-subtle: '#38383a'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: -0.01em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 20px
  margin-desktop: 40px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

The design system is centered on a **Premium Fluid** aesthetic, drawing heavily from modern iOS patterns and high-end audio hardware. The personality is sophisticated, precise, and physical, catering to audiophiles who value both technical fidelity and tactile interaction.

The style is defined by **Glassmorphism** and high-contrast depth. By utilizing a pure black foundation, the interface allows album artwork and vibrant glass materials to "float" with physical presence. Interactions must feel instantaneous and organic, utilizing spring physics to create a sense of momentum and inertia rather than linear transitions.

## Colors

The system uses a **Strict Dark Mode** palette. The absolute black (`#000000`) background is essential for maximizing the perceived dynamic range of the display and allowing glass layers to provide structural hierarchy.

*   **Primary Accent:** Apple Blue is used sparingly for active states and critical calls to action.
*   **Materiality:** Elevated surfaces (cards and panels) use a translucent glass effect with `blur(40px)` and `saturate(180%)`.
*   **Quality Indicators:** Semantic colors are reserved for high-fidelity audio badges, creating a distinct visual shorthand for audio quality without cluttering the primary interface.
*   **Dynamic Layering:** Behind the main interface, a dynamic background layer reflects the current album art, blurred at 100px and saturated at 200%, creating a localized "glow" that changes with the music.

## Typography

This design system utilizes **Inter Variable** to achieve a high-end, technical look. 

*   **Headlines:** Feature tight tracking and high weights to feel impactful and modern.
*   **Body:** Optimized for legibility against dark backgrounds, using a slightly more generous line-height and optical sizing features.
*   **Badges/Labels:** Use small-caps or uppercase styling with increased letter spacing for a "technical spec" feel, particularly on quality indicators like Hi-Res Lossless.

## Layout & Spacing

The layout follows a **Fluid Grid** model designed to feel native on both mobile and desktop. 

*   **Margins:** Use a standard 20px margin on mobile, expanding to 40px on desktop to allow for the immersive dynamic background to breathe.
*   **The "Floating" Principle:** Elements should rarely touch the edges of the viewport. The primary player bar is absolutely positioned at the bottom with a 12px inset from the screen edges, appearing as a floating physical object.
*   **Responsiveness:** On desktop, the tracklist and album art use a 12-column layout. On mobile, the interface collapses into a single-column vertical scroll with the player bar docked at the bottom.

## Elevation & Depth

Depth is not communicated via shadows alone, but through **Material Stacking**.

1.  **Level 0 (Base):** Pure Black `#000000` with blurred album art texture.
2.  **Level 1 (Cards/Lists):** Translucent glass with subtle 1px white border at 10% opacity.
3.  **Level 2 (Overlays/Player Bar):** Higher saturation and blur materials, creating a distinct "top-most" layer.
4.  **Shadows:** When used (e.g., on album covers), shadows should be tight and high-density (`0px 4px 12px rgba(0,0,0,0.5)`) to make the art feel like it is hovering just above the glass.

## Shapes

The shape language is **Highly Rounded**, mimicking the hardware curvature of premium headphones and devices. 

*   **Standard Containers:** Use 0.5rem (8px) for internal elements.
*   **Large Components:** Player bars and search inputs use `rounded-2xl` (1.5rem/24px) or full pill-shapes to maintain a soft, approachable feel amidst the technical dark UI.
*   **Album Art:** Should always feature a 4px to 8px radius; never leave art perfectly sharp.

## Components

### 1. Glass Player Bar
The flagship component. It must span the width (minus margins) and feature a `backdrop-filter: blur(40px)`. The play button is a solid white circle; all other icons are muted white.

### 2. Quality Badges
Small, high-contrast pills.
*   **Hi-Res:** Purple border, 11px Bold Inter.
*   **Lossless:** Emerald border.
*   **Dolby Atmos:** Blue border.
These badges use a 10% background tint of their respective color for legibility.

### 3. Custom Progress Bar
A 2px white line. The "buffered" part of the track is at 20% opacity. On hover, a 12px circular white thumb appears. The interaction must be "sticky" and use spring physics during scrubbing.

### 4. Search Input
A pill-shaped glass container. On focus, the 1px border transitions from `#38383a` to `#ffffff`, and the backdrop blur increases slightly to pull the input forward.

### 5. Buttons & Interaction
*   **Micro-interactions:** Scale down to 95% on press (`active:scale-95`).
*   **Spring Settings:** Use `stiffness: 200, damping: 25` for all UI movements to ensure they feel "heavy" and premium rather than "bouncy" or "cheap."
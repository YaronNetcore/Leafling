# Leafling — Design System

Source of visual direction: the seven owner-supplied references (welcome, onboarding ×4, My Plants, plant details). Rendered results for review: `docs/design/screens/*.webp` (393×852, light and dark).

## Principles
- Natural & soft + cute & illustrated, never childish or clinical. Plant photos are the hero; botanical decoration supports, never crowds.
- Hebrew-first, true RTL: logical properties only (`start`/`end`, `ms`/`pe`…). Back buttons sit at the start (right) and point right; "forward" chevrons point left. Scientific names use `.sci` (isolated LTR, italic).
- Calm wording: no guilt, no "overdue" pressure; tasks and suggestions look different (suggestions are dashed, optional).

## Tokens (`src/app/styles.css`)
| Token | Light | Dark (warm, not black) | Use |
|---|---|---|---|
| `bg` | `#f6efe2` cream | `#171a14` | page |
| `surface` | `#fffcf5` | `#23281e` | cards |
| `sage` / `sage-strong` | `#e5ead3` / `#d6dfbf` | `#2e3826` / `#39462f` | selected, soft panels |
| `green` | `#3d6534` forest | `#8fbf72` | primary actions, active tab |
| `ink` / `text` / `muted` | `#26351f` / `#3a3f33` / `#7a7768` | light equivalents | headings / body / secondary |
| `water`, `sun`, `soil`, `heat` (+ `-bg`) | blue, amber, clay, red | brighter pastels | care icons |
| `ok`, `attention`, `problem`, `urgent` | green, yellow, orange, red | — | semantic status (always with text, never colour alone) |

Font: Rubik Variable (self-hosted, OFL). Radius: cards 24px, buttons/chips pill, inputs 16px. Shadow: soft warm two-layer.

## Components (`src/app/ui/`)
Button (primary / secondary / outline / text / danger, loading state), IconButton, Card, Chip + TabRow, Sheet (bottom sheet), Field/Input/Select/Textarea, PlantImage (personal photo → species image → illustrated fallback), StatusBadge, ConfidenceBadge (text + dots, no percentages), InfoNote, EmptyState, ActionRow, IconBubble, Wordmark, Toast. Icons: inline stroke set (`icons.tsx`).

## Imagery
- Illustrations and plant photos in `public/img/` are crops from the supplied references (overlays removed by inpainting). They are placeholders until final art is supplied; species photos are clearly species images, never presented as the user's own plant.
- Decorative crops use soft masks (`.deco`, `.deco-pot`, `.soft-edge`) so no rectangle edges show; in dark mode they dim.
- App icons derive from the approved icon (`assets/brand/leafling-icon-original.jpg`, unchanged) with the approved inner-tile crop.

## Motion
Short rise/fade on entry, bottom-sheet slide, a small "sprout" celebration for milestones (first sprout/root, recovery, wishlist purchase). All disabled under `prefers-reduced-motion`.

## Navigation
Exactly five tabs (RTL order): היום · מצא צמח · הצמחים שלי · המיקומים שלי · כלים. Floating + (top-level tabs only) offers exactly: זיהוי צמח, AI Botanist. Diagnose is contextual (plant card, care tasks, tools).

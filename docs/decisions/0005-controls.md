# 0005 — A gesture always means the same thing

**Status:** Accepted · 2026-08-06

## Context

The first control scheme bound camera panning to **left-drag while the select tool was
active**, with middle-drag as an escape hatch for other modes. In play this failed
immediately and repeatedly: reaching for the camera with a tool selected painted a
stockpile or queued a wall instead. The same physical gesture did different things
depending on state that isn't visible while you're looking at the map.

Middle-drag existed as the mode-independent alternative, but requiring a third button for
the single most frequent action in the game is not a solution.

## Decision

**The right button always moves the camera. The left button always applies the current
tool.** Neither meaning depends on the active mode.

| Gesture | Always means |
|---|---|
| Right-drag | Pan the camera |
| Right-click (no travel) | Give an order, or cancel the active tool |
| Left-drag | Apply the current tool |
| Left-click | Select |
| Wheel | Zoom at cursor |
| WASD | Scroll |

Middle-drag also pans, for anyone who expects it, but nothing requires it.

A press counts as a click rather than a drag if the pointer travelled less than
`CLICK_SLOP` (5px), which is what lets one button carry both "pan" and "order".

## Why right-click also cancels

The original complaint was two-part: accidental painting *and* mode switching feeling
heavy. Cancelling on right-click is the convention every RTS shares, and it removes the
main cost of entering a tool — leaving it no longer means travelling to the toolbar or
remembering a key.

Order of precedence: cancelling the tool wins. With a tool active you are placing things,
not commanding people, so "never mind" is the more likely intent.

## Consequences

- **Left-drag in select mode now does nothing.** That is the natural home for a
  drag-select box when squad command arrives in Slice 5.
- **The cursor carries the mode**: `default` in select, `crosshair` with a tool,
  `grabbing` mid-pan. It is the only persistent signal of what the left button will do,
  so `CameraController` saves and restores whatever was there rather than assuming.
- Panning while a tool is active is now safe, which means tools can stay selected across
  camera moves — the thing that made the old scheme tiring.

## Alternatives rejected

- **Keep left-drag panning, add a modifier key.** Still mode-dependent, and now requires
  a keyboard hand for a mouse action.
- **Middle-drag only.** Rejected by the player outright; a three-button requirement for
  the most common action is a poor default and bad on trackpads.
- **Edge scrolling.** Solves panning without a button, but fights window edges and does
  nothing about accidental painting, which was the actual complaint.

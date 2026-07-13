/**
 * Shared preset palette for activity groups.
 * Keep in sync with Flutter `lib/theme/tokens/group_palette.dart`.
 */
export const GROUP_COLOR_PALETTE = [
  '#0F766E', // teal (brand)
  '#2563EB', // blue
  '#7C3AED', // violet
  '#DB2777', // pink
  '#DC2626', // red
  '#EA580C', // orange
  '#CA8A04', // yellow
  '#16A34A', // green
  '#0891B2', // cyan
  '#4B5563', // gray
] as const

export type GroupColor = (typeof GROUP_COLOR_PALETTE)[number]

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/

export function isAllowedGroupColor(color: string): color is GroupColor {
  if (!HEX_COLOR_RE.test(color)) return false
  const normalized = color.toUpperCase()
  return (GROUP_COLOR_PALETTE as readonly string[]).some(
    (c) => c.toUpperCase() === normalized,
  )
}

/** Normalize to canonical `#RRGGBB` uppercase from the allowlist. */
export function normalizeGroupColor(color: string): GroupColor {
  const match = (GROUP_COLOR_PALETTE as readonly string[]).find(
    (c) => c.toUpperCase() === color.toUpperCase(),
  )
  if (!match) {
    throw new Error(`Invalid group color: ${color}`)
  }
  return match as GroupColor
}

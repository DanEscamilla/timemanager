# Time Manager Design System

Source of truth for UI tokens and component usage in `apps/timemanager`.
Implementation lives under `lib/theme/` and `lib/widgets/`.

## Principles

- Material 3 primitives, wrapped by semantic tokens
- Calm teal brand seed `#0F766E`
- Soft surfaces, rounded cards, generous whitespace
- Components never hardcode colors — use `Theme.of(context)`
- Light and dark themes from the same token maps

## Color

| Semantic | Purpose | Mapping |
|----------|---------|---------|
| Primary | Brand actions, highlights | `ColorScheme.primary*` |
| Secondary / Tertiary | Supporting accents (calendar recurring = tertiary) | `secondary*` / `tertiary*` |
| Background | App canvas | `surface` |
| Surface | Cards, sheets | `surfaceContainer*` |
| Success / Warning / Info | Status | `Theme.statusColors` (`AppStatusColors`) |
| Error | Destructive | `error*` |
| Text | Body / muted | `onSurface` / `onSurfaceVariant` |
| Border | Dividers, outlines | `outline` / `outlineVariant` |

Theme mode: Light / Dark / System via `ThemeModePreferenceService` (Settings + debug drawer).

## Typography

Plus Jakarta Sans via `google_fonts` when runtime fetching is allowed; DS size/weight scale always applied. Roles: display 32/w700, headline 24/w600, title large 20 / medium 16 / small 14, body large 16 / medium 14 / small 12, label large 14 / medium 12 / small 11.

## Spacing

`xs` 4 · `sm` 8 · `md` 16 · `lg` 24 · `xl` 32 · `xxl` 48 (`AppSpacing`). Screen padding = `lg`, card padding = `md`.

## Radius

`sm` 8 · `md` 12 · `lg` 16 · `pill` 999 (`AppRadius`).

## Elevation

Tonal surfaces preferred: level 0–3 (`AppElevation`). Cards use elevation 0 + `surfaceContainerLow`.

## Icons

Material Icons. Sizes: 16 / 20 / 24 / 48 (`AppIconSizes`). Touch targets ≥ 48dp.

## Motion

Material ink + fade page transitions. Prefer `AnimatedSwitcher` for local swaps.

## Components

| Widget | Use |
|--------|-----|
| `AppCard` | Group related content |
| `StatCard` | Overview KPIs |
| `EmptyState` | No data + optional CTA (`compact` inside cards) |
| `ErrorState` | Fetch failure + Retry |
| `LoadingView` | Full-page loading |
| `ActivityListTile` | Activity row with schedule + actions |
| Buttons / fields | Themed Material (`FilledButton`, `inputDecorationTheme`) |

## Layout

Breakpoint `AppBreakpoints.medium` (800): `NavigationRail` above, `NavigationBar` below. Overview is a card grid (1 column narrow, 2 columns wide). Tabs: Overview · Activities · Calendar.

## Accessibility

AA contrast on semantic pairs, visible focus/hover colors, 48dp targets, status not color-only.

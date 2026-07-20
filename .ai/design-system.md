# Design System

Source of truth for UI tokens and component usage across Flutter apps.
Implementation lives in [`libs/design_system`](../libs/design_system).

Today only `apps/timemanager` consumes it via a path dependency. Domain-specific
widgets (activity tiles, goal cards, calendar_view theme) stay in the app.

## Principles

- Material 3 primitives, wrapped by semantic tokens
- Calm teal brand seed `#0F766E`
- Soft surfaces, rounded cards, generous whitespace
- Components never hardcode colors — use `Theme.of(context)`
- Light and dark themes from the same token maps
- No app l10n or domain models in the shared kit — callers inject strings

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

Theme mode: Light / Dark / System via app `ThemeModePreferenceService` + shared `ThemeModeRadioGroup`.

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
| `ErrorState` | Fetch failure + Retry (caller supplies `title` / `retryLabel`) |
| `LoadingView` | Full-page loading |
| `AdvancedFormSection` | Collapsible advanced form block (caller supplies labels) |
| `RewardCard` | Generic entity row (app maps models → props) |
| `ThemeModeRadioGroup` | System / Light / Dark radios |
| `ColorSwatchButton` | Palette picker swatch |
| `AppTimeField` / `AppDateField` | Tappable date/time inputs |
| `LoginView` | Email/password (+ optional OAuth) form; callers inject copy + auth callbacks |
| Buttons / fields | Themed Material (`FilledButton`, `inputDecorationTheme`) |

App-local: `ActivityListTile`, goal progress cards, `calendar_view` theme merge (`withCalendarTheme`).

## Layout

Breakpoint `AppBreakpoints.medium` (800): `NavigationRail` above, `NavigationBar` below. Overview is a card grid (1 column narrow, 2 columns wide).

## Accessibility

AA contrast on semantic pairs, visible focus/hover colors, 48dp targets, status not color-only.

## Future: web tokens

Flutter-only today. When `user-manager-web` (or other React apps) should match this look, export the same semantic token scale (colors, spacing, radius, type roles) to CSS custom properties or a JSON scale consumed by the web design layer. Do not duplicate brand values ad hoc in React — mirror this package’s token map.

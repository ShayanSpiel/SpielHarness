# SpielOS Design System

This document is the visual source of truth for SpielOS. It preserves the product's dense operational character while making every reusable visual decision explicit, themeable, and testable.

## Authority

Use decisions in this order:

1. Semantic tokens in `packages/design-system/src/tokens/`.
2. Shared primitives in `packages/design-system/src/components/`.
3. Composition contracts in this document and `docs/interaction-design.md`.
4. Page composition in `apps/web/`.

Page code may arrange primitives, but must not redefine their colors, radii, icon sizes, focus treatment, motion, or state behavior. If a design decision must be repeated, add it to the design system first.

## Principles

- Preserve the current layout and product identity. Polish through hierarchy and consistency, not decoration.
- Use semantic meaning, never palette names, in product code.
- Prefer one quiet visual cue over several competing cues.
- Keep neutral structure neutral. Reserve chromatic color for action, status, risk, and identity.
- Make state changes visible without moving the surrounding layout.
- Render runtime truth. Never fabricate progress, reasoning, completion, or workflow activity.
- Use shared primitives before creating local controls.

## Tokens

### Structural tokens

Structural tokens are theme-independent:

- Radius: `sm`, `md`, `lg`, `xl`, and `pill`.
- Motion: `fast`, `default`, `slow`, and the shared easing curve.
- Typography: font families, sizes, and line heights.
- Focus: `--focus-border` and `--focus-ring`, derived from the active theme.
- Disabled: `--disabled-surface`, `--disabled-border`, and `--disabled-foreground`; never invent component-local opacity or gray values.
- Shadows: `panel` and `popover`.

Do not use literal pixel radii, animation durations, easing curves, or box shadows in application code.

### Semantic color tokens

Components consume:

- Canvas: `background`, `background-deep`.
- Surfaces: `panel`, `panel-raised`, `panel-strong`, `input`.
- Interaction: `hover`, `selected`, `border`, `border-strong`, `ring`.
- Text: `foreground`, `foreground-strong`, `foreground-muted`, `muted-foreground`.
- Product action: `primary`, `primary-foreground`, `primary-soft`.
- Operational meaning: `success`, `warning`, `destructive`, `info`, `accent`, `purple`, and their soft variants.

Raw hex, rgb, hsl, palette utility classes, gradients, and inline visual color styles are forbidden outside token files.

## Surface hierarchy

Use surface differences to establish depth before adding borders or color.

| Level | Token | Use |
| --- | --- | --- |
| 0 | `background-deep` | Recessed application edge or shell depth only |
| 1 | `background` | Main canvas, editor canvas, list canvas |
| 2 | `panel` | Sidebar inspector, card, modal body |
| 3 | `panel-raised` | Toolbar, section header, control group, inset region |
| 4 | `panel-strong` | Floating composer, popover, elevated prompt |
| Input | `input` | Editable control interior |

Rules:

- Do not stack adjacent surfaces with the same border and background unless separation is required.
- A full-height sidebar gets one boundary border. Its internal rows do not all become cards.
- A toolbar or section header may use `panel-raised`; content below returns to its parent surface.
- A floating surface uses one border and the appropriate shared shadow.
- Command and context pickers use the named `DialogContent` layouts; pages do not restate modal position, size, radius, shadow, or motion.
- Do not add a full-width footer surface behind the chat composer.

## Borders and focus

- Default separator or boundary: one pixel `border`.
- Hoverable boundary: transition from `border` to `border-strong`.
- Selected item: `selected` surface plus at most one clear selected boundary.
- Keyboard focus: `--focus-border` with the restrained `--focus-ring` halo.
- Warning and destructive borders communicate state, not focus.
- Dashed borders are reserved for empty drop targets and creation affordances.
- Avoid nested borders. If a child already has a boundary, its parent usually needs only spacing or surface contrast.

Focus treatment must come from shared controls. Page-local `ring-*`, focus opacity, and focus colors are not allowed.

## Radius

- `rounded-sm`: tiny indicators, keyboard keys, menu items, checkbox shapes.
- `rounded-md`: buttons, inputs, list rows, composers, cards, panels, dialogs.
- `rounded-lg`: only a genuinely larger grouped surface whose children use `md`.
- `rounded-xl`: exceptional branded or onboarding surfaces only.
- `rounded-full` or `pill`: avatars, radio indicators, switches, progress tracks, pills.

Do not choose radius based on available Tailwind classes. Choose it from the component contract.

## Typography

Typography creates most of the hierarchy. Do not compensate for weak hierarchy with excessive borders or color.

| Role | Standard |
| --- | --- |
| Page title | `text-base`, semibold, `foreground-strong` |
| Panel title | `text-sm`, semibold, `foreground` |
| Body and control label | `text-sm`, regular or medium |
| List title | `text-sm`, medium |
| Dense modal/selector title | `text-xs`, medium |
| Supporting text | `text-xs`, `muted-foreground` |
| Dense metadata | `text-2xs`, `muted-foreground` |
| Eyebrow/category | `text-2xs`, semibold, uppercase, tracked |
| Micro status/key hint | `text-3xs` |
| Code/data | shared mono family at the matching hierarchy level |

Rules:

- Use sentence case for labels and headings.
- Use uppercase only for short categories, not navigation or button labels.
- Avoid arbitrary `text-[Npx]` values. Add a named token if a legitimate new role exists.
- Limit a local view to three simultaneous text emphasis levels.
- Muted text must remain readable in every theme; it is secondary, not disabled.

## Icons

All product icons use the shared `Icon` registry. Do not import an icon library from application code.

| Context | Icon | Control box |
| --- | --- | --- |
| Micro inline indicator | 10px | none |
| Compact answer/table action | 12px | 24px |
| Dense list or toolbar | 14px | 28px |
| Standard primary control | 16px | 32px |
| Empty state | 20–24px | shared empty-state container |
| Hero/onboarding | 28–32px | explicit shared composition |

- Icon-only actions always have an accessible label and tooltip.
- Use one icon family and stroke character through the registry.
- Do not enlarge an icon to make an action feel more important; use button hierarchy.
- Destructive icons become destructive only when the action is imminent or confirmed.

## Buttons and actions

Use the shared `Button` variants:

- `primary`: the single preferred action in the current scope.
- `outline`: secondary action requiring visible affordance.
- `subtle`: quiet action inside a raised surface.
- `ghost`: reversible toolbar or row action.
- `danger`: confirmed destructive action.
- `link`: navigation presented inline with text.

Every action supports default, hover, active, keyboard focus, disabled, and loading states. Loading keeps the button width stable, disables repeat submission, and replaces or precedes the leading icon with the shared loader. Do not change the button label to vague copy such as “Working”.

## Lists and sidebars

- Navigation rail, resource list, main editor, and inspector are distinct layout roles.
- The navigation rail groups destinations as Runtime, Files, and Context. Restrained semantic markers and active icon color distinguish groups; inactive icons remain neutral. Item tooltips contain only the page name; group labels remain structural and accessible.
- List rows and selectable options are borderless. Use spacing, typography, hover surface, selected surface, and the radio/checkbox indicator to communicate structure and state. Borders belong to containers, inputs, and structural separators—not repeated rows.
- Dense editor and breadcrumb toolbars use `icon-xs` for icon-only actions. Labeled primary actions retain their normal control size; global layout toggles may use the standard icon size.
- Editor metadata grids are container-driven. Use `--editor-field-min` (or the compact variant for dense criteria) with auto-fit instead of viewport breakpoints or page-local field widths.
- Sidebars use shared width constants and one boundary border.
- Resource sidebars use `ResizableSidebar`, persist their width by identity, support pointer and keyboard resizing, and restore their contract default on double-click.
- Sidebar headers use a consistent height, typography, count placement, and new-item action.
- Search sits in a separate compact section only when the list needs filtering.
- Rows use `ListItem` or an approved selectable-row primitive.
- Active navigation uses surface and text emphasis. It does not use a checkbox.
- Metadata aligns to the trailing edge and never competes with the row title.
- Empty, loading, error, and populated states occupy the same content region.

## Tabs

- Use shared `Tabs` or `NavTabs`.
- Sidebar tabs divide available width equally and center their content.
- Tabs change views; they do not perform actions.
- Active state uses selected surface and foreground emphasis.
- Do not introduce dropdown navigation when three to five peer views fit as tabs.

## Forms

- Labels describe the value, not the implementation.
- Required state appears in the label or supporting copy, not placeholder-only text.
- Help text precedes validation text; errors remain adjacent to the field.
- Inputs, textareas, and selects share height, radius, background, focus, and disabled treatment.
- Group related boolean settings with `ToggleRow`; use a switch only for an immediate binary state.
- Preserve user input after validation or network failure.

## Themes

Every theme maps the complete semantic contract. A component is not complete until it works in all registered dark and light themes.

- Theme differences come from token mapping, never component branches.
- Structural contrast must distinguish canvas, panel, raised area, input, hover, and selected states.
- Operational colors must remain distinguishable in monochrome themes.
- Primary must not be reused for every selected or informational state.
- Meet WCAG AA text contrast and visible-focus requirements.
- Test at least one dark, one light, and one monochrome theme during visual review.

## Runtime and chat

- Model text is the assistant answer.
- Native events render as compact activity rows, not bordered transcript cards.
- Loading language comes from runtime events.
- Terminal and waiting states do not animate.
- Human input appears above the shared composer and uses the composer for text answers.
- The chat composer floats on the canvas.
- Attached harness chips use a boundary, entity icon, title, and explicit remove affordance.
- The active assistant identity follows the native role event.

See `docs/interaction-design.md` for selection, loading, creation, dialog, motion, and feedback behavior.

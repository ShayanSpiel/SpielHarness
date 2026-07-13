# SpielOS Interaction Design

This document is the behavioral source of truth for controls and workflows. Visual values come from `docs/design-system.md` and the design-system package.

## Universal state contract

Every interactive component must deliberately support:

1. Resting.
2. Hover, when a pointing device is present.
3. Active/pressed.
4. Keyboard focus.
5. Disabled, with the reason discoverable when useful.
6. Loading, when the component initiated asynchronous work.
7. Success or failure feedback at the correct scope.

Do not represent two meanings with the same cue. Focus is not warning. Selection is not success. Disabled is not loading.

## Selection patterns

Choose by user intent:

| Intent | Pattern | Example |
| --- | --- | --- |
| Choose one value in a form | Radio group | Model or execution mode |
| Choose several persistent values | Checkbox rows | Skills assigned to a role |
| Turn an immediate setting on/off | Switch | Role active state |
| Open a view | Navigation highlight | Sidebar resource or tab |
| Attach removable context | Add/Attached row action plus selected row | Harness item added to chat |
| Pick one item and close | Command/menu selection | Open file or navigate |

Checkmarks are correct for skills assigned to a role because the relationship is persistent multi-selection. They are less clear for chat context: attaching is an action with compatibility rules, so use a trailing `Add`/`Attached` affordance and retain a visible selected row state. Do not show an empty checkbox for items that are mutually exclusive or may be unavailable for a reason.

Selection behavior:

- The entire row may be clickable when it has one unambiguous action.
- Keep selection visible after focus moves.
- Explain unavailable choices through supporting text or a tooltip.
- Do not silently replace an incompatible selection. Ask or make the replacement explicit.
- Bulk selection requires a visible selected count and bulk action area.

## Creating and adding items

Use this lifecycle for roles, skills, workflows, evals, files, connections, and similar resources:

1. The New action creates a local draft and selects it.
2. Focus moves to the first meaningful field.
3. The list clearly distinguishes the unsaved draft without pretending it exists remotely.
4. Save disables duplicate submission and shows loading inside the initiating button.
5. Success replaces the draft identity with the durable item, retains selection, and shows a scoped success toast.
6. Failure preserves the draft, returns focus to the relevant field or error, and shows actionable feedback.
7. Navigation with unsaved changes uses the shared dirty-state confirmation.

Prefer explicit save for complex harness resources. Use optimistic updates only for reversible, low-risk changes with a reliable rollback.

## Loading and progress

- Button work: loader inside the button that initiated it.
- Local content fetch: skeleton or quiet loader inside the content region.
- Background refresh: preserve existing content and use a subtle local indicator.
- Runtime execution: native event rows and canonical lifecycle status.
- Empty results after loading: empty state, never a permanent spinner.

Loading must have one owner. Do not maintain page-local loading booleans that compete with a durable runtime lifecycle. A terminal status always clears animation and pending human input.

## Feedback

- Inline validation for correctable field problems.
- `Notice` for contextual errors or warnings inside a view.
- `AppToaster` for completed cross-view operations and failures not tied to one field.
- Confirmation dialog before destructive, difficult-to-reverse work.
- Status `Pill` for durable state, not transient feedback.

Success copy names the result: “Role created.” Failure copy names the failed operation and, when known, the correction. Avoid “Something happened”, “Running”, and “Done” without context.

## Dialogs, popovers, and drawers

- Dialog: blocking decision or focused task that cannot coexist with the underlying page.
- Popover: lightweight contextual choice anchored to a trigger.
- Drawer/inspector: persistent supporting context while the primary surface remains usable.
- Anchored human-input panel: runtime interruption connected to the composer; it is not a transcript message and does not dim the page.

Inspectors use the shared width contract from `SIDEBAR.INSPECTOR`. On desktop they resize from the inner edge with pointer drag or arrow keys; Home/End select the minimum/maximum and double-click restores the default. On narrower layouts they overlay the primary view with a dismissible backdrop instead of compressing it. Every inspector uses the shared header, equal-width tabs, scroll body, sections, footer, and empty state.

Dialogs use the shared overlay, border, surface, radius, shadow, focus trap, Escape behavior, and entry/exit motion. Do not restyle `DialogContent` at each call site. Large selection dialogs may define size and placement, but not visual chrome.

On open:

- Move focus to the first useful control, not automatically to a destructive action.
- Preserve the opener so focus returns on close.
- Keep the title and close action stable.
- Avoid stacking dialogs. Convert nested choices to a step or popover where possible.

## Motion

Motion explains change; it does not decorate static UI.

- `fast`: hover, pressed, icon and color feedback.
- `default`: menu, tooltip, small popover, selection transition.
- `slow`: drawer, inspector, larger dialog, layout reveal.
- Shared easing only.

Animate opacity and transform where possible. Avoid animating layout dimensions except established panels. Respect reduced-motion preferences by removing nonessential transforms and shortening state transitions.

No perpetual animation outside active progress. Completed, failed, cancelled, waiting, and disabled states are still.

## Tooltips and labels

- Text buttons do not need tooltips unless they explain availability.
- Icon-only buttons require a concise accessible label and tooltip.
- Tooltip copy names the action: “Copy answer”, “Regenerate answer”, “Edit message”.
- Do not put essential instructions only in a tooltip.
- Use consistent terminology across navigation, headings, actions, toasts, and API-facing errors.

## Keyboard and accessibility

- All functionality is keyboard reachable in logical order.
- Focus is visible in every theme.
- Escape closes the topmost dismissible layer.
- Enter submits only where expected; multiline editors preserve newline behavior.
- Selection controls expose radio, checkbox, switch, or pressed semantics matching their behavior.
- Dynamic status changes use appropriate live-region behavior without repeatedly announcing streaming tokens.
- Icon color is never the sole state indicator.

## Verification states

Review each reusable component in:

- Default, hover, active, focus, disabled.
- Empty, populated, overflow, long label.
- Loading, success, warning, error where applicable.
- Dark, light, and monochrome themes.
- Keyboard-only and reduced-motion modes.
- Narrow and wide layouts where the component is responsive.

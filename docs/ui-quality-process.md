# UI Quality Process

SpielOS is polished system-first, not page-by-page. The goal is to improve every screen while preserving established layout and product intent.

## Why this process

Editing fifty screens independently produces drift. A shared primitive correction should improve every consumer. Page-specific work begins only after the relevant tokens, primitive, and behavior contract exist.

## Rollout sequence

### 1. Inventory

For each route and shared component, record:

- Surface role and boundaries.
- Typography roles.
- Controls and their state coverage.
- Selection model.
- Empty, loading, success, warning, error, and disabled states.
- Dialogs, popovers, drawers, toasts, and keyboard behavior.
- Theme and responsive exceptions.

Inventory by pattern as well as route. Fixing all icon-only actions together is safer than opportunistically changing icon sizes on unrelated screens.

### 2. Establish primitives

Promote repeated decisions into the design-system package:

- Surface and panel compositions.
- Buttons and icon buttons.
- Inputs and field groups.
- Tabs and navigation rows.
- Selection rows for radio, checkbox, and attach/detach behavior.
- Empty, loading, notice, status, and toast components.
- Dialog, popover, drawer, and sidebar shells.

Do not create a primitive for a one-off layout. Create one when the visual or behavioral rule repeats.

### 3. Build the state gallery

Create a development-only route containing every shared primitive and all supported states. It must use deterministic fixtures and no production data.

The gallery is the fastest place to tune:

- Typography hierarchy.
- Surface contrast.
- Borders and focus.
- Icon scale.
- Loading and disabled states.
- Theme mappings.
- Motion and reduced motion.

### 4. Establish golden workflows

Capture representative screens rather than every component instance:

1. Plain assistant chat, empty and streaming.
2. Workflow chat, running, waiting for input, success, and failure.
3. Role editor with skills selected and unsaved changes.
4. Skill editor with connections and unavailable operations.
5. Workflow graph with selected, connecting, failed, and completed nodes.
6. File browser/editor with empty, populated, dirty, and error states.
7. Settings with connections, variables, models, and theme selection.
8. Evals with empty criteria, running result, pass, and fail.

Capture dark, light, and monochrome variants. Review visual diffs before accepting intentional baseline changes.

### 5. Migrate by vertical pattern

Recommended order:

1. Focus, disabled, hover, loading, and action icon scale.
2. Typography roles and icon registry usage.
3. App shell, navigation rail, sidebars, tabs, and inspector surfaces.
4. Forms, editors, creation, save, dirty, and delete behavior.
5. Selection patterns for role skills, chat context, connections, and workflow nodes.
6. Dialogs, command palette, popovers, toasts, and empty/error states.
7. Chat runtime, artifacts, workflow graph, and eval-specific states.
8. Theme contrast and responsive/reduced-motion finishing pass.

Finish one pattern across its consumers before starting another. Do not mass-rewrite pages.

## Change budget

For each polish change:

- State the violated contract.
- Change the highest shared layer that owns the decision.
- Keep DOM and layout structure unless the interaction contract requires a change.
- Avoid unrelated cleanup.
- Compare before/after in the same theme, viewport, and data state.
- Test every state affected by the shared primitive.
- Revert visual expansion that does not improve hierarchy, comprehension, or feedback.

## Automated guardrails

Required checks:

```bash
npm run typecheck
npm run lint
npm run check:ui
npm test
```

Use `npm run build` for larger UI or API changes. The UI check rejects raw colors and structural hardcoding that belongs in tokens.

Visual regression should become a required CI check after the state gallery and golden screenshots are committed. Baseline updates require human review.

## Definition of done

A component is polished only when:

- It uses semantic tokens and shared primitives.
- Its surface role is clear without unnecessary borders.
- Typography and icons follow named scales.
- All interaction and asynchronous states are designed.
- Selection semantics match user intent.
- Feedback appears at the correct scope.
- Keyboard and focus behavior work.
- Dark, light, and monochrome themes retain hierarchy and contrast.
- Long content, empty content, errors, and loading do not break layout.
- Browser verification and automated checks pass.
- The change does not alter unrelated screens or invent runtime state.

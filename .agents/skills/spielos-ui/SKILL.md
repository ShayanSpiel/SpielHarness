---
name: spielos-ui
description: Preserve and polish the SpielOS interface through its semantic tokens, shared components, interaction contracts, theme mappings, and visual verification workflow. Use for any SpielOS UI implementation, review, refactor, component creation, layout or sidebar change, chat/runtime presentation, form or selection behavior, loading/error/success state, icon or typography adjustment, modal/popover/drawer work, animation, accessibility, theme work, or visual polish request.
---

# SpielOS UI

Polish the existing product without reskinning it. Move repeated decisions upward into tokens and primitives, then verify their consumers and states.

## Read the contract

Before editing UI, read these files completely:

1. `../../../docs/design-system.md` for visual tokens, hierarchy, surfaces, typography, icons, and component rules.
2. `../../../docs/interaction-design.md` for selection, creation, loading, feedback, overlays, motion, and accessibility.
3. `../../../docs/ui-quality-process.md` for migration order, change budget, visual baselines, and definition of done.

For chat or execution UI, also read:

- `../../../docs/ui-workbench.md`
- `../../../docs/langgraph-runtime.md`

Treat the documents and `packages/design-system` as authoritative. If code and documentation disagree, identify the drift explicitly and fix the highest shared owner in scope.

## Workflow

### 1. Establish evidence

- Inspect the current component, every shared primitive it consumes, and representative callers.
- Render the existing UI before changing it when visual behavior is involved.
- Record the affected states: resting, hover, active, focus, disabled, loading, success, warning, error, empty, and overflow.
- Identify the active theme and include dark, light, and monochrome verification for shared changes.

Do not infer visual quality from class names alone.

### 2. Find the owner

Choose the highest correct layer:

1. Theme palette for raw colors.
2. Semantic token for repeated meaning.
3. Shared primitive for repeated appearance or behavior.
4. Composition component for a repeated product pattern.
5. Page code only for unique layout and content.

Do not patch multiple pages with the same class change. Create or correct the shared owner.

### 3. Preserve product structure

- Keep established information architecture, density, and layout unless the requested interaction requires change.
- Avoid broad rewrites, decorative redesign, gradients, oversized type, floating cards, and unnecessary chrome.
- Use surface hierarchy, typography, spacing, and state feedback before adding color or borders.
- Keep each change within one named pattern or vertical slice.

### 4. Implement complete states

- Use shared controls and semantic tokens.
- Give every action its full state contract.
- Keep asynchronous ownership local to the initiating control or canonical runtime lifecycle.
- Preserve drafts and user input on failure.
- Match selection control to intent: radio, checkbox, switch, navigation, or attach/detach.
- Use the shared icon registry and named icon-button sizes.
- Use shared motion duration and easing tokens; respect reduced motion.

Runtime messages, reasoning summaries, workflow steps, and progress must come from native provider or LangGraph events. Never fabricate them in UI copy.

### 5. Verify visually and mechanically

Use the browser to verify the real route and interaction. Compare before and after at the same viewport, theme, and data state.

Run:

```bash
npm run check:ui
npm run typecheck
npm run lint
```

Run `npm test` when state or behavior changes. Run `npm run build` for shared primitive, routing, or larger UI changes.

Inspect for:

- Unexpected layout movement.
- Nested or overly bright borders.
- Incorrect icon scale.
- Weak surface or type hierarchy.
- Missing hover, focus, disabled, loading, error, or success states.
- Theme-specific contrast loss.
- Stale loading after terminal state.
- Duplicate feedback.
- Keyboard traps and focus loss.

### 6. Report precisely

State which contract was fixed, which shared owner changed, which consumers were verified, and which checks ran. Identify remaining out-of-scope design debt without claiming the whole app was polished.

## Non-negotiable rules

- Do not use raw colors, pixel typography, radius values, shadows, animation timing, or easing in application code.
- Do not import icon libraries outside the design system.
- Do not create page-local copies of shared controls.
- Do not use warning or error color merely to show focus or selection.
- Do not represent navigation as a checkbox.
- Do not use an empty checkbox for an attach action with compatibility rules.
- Do not add borders where spacing or a surface transition already establishes grouping.
- Do not update screenshot baselines until a human has reviewed the intentional visual change.
- Do not modify unrelated screens to make a local polish diff look consistent.

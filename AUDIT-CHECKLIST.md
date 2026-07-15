# SpielOS UI Audit — Master Checklist

> **Purpose:** Single source of truth for the full-page, every-component UI audit.
> **Process:** Check each item across ALL audit dimensions. Update status after each pass.
> **Dimensions:** Behavior, Animations, Loading/Skeletons, Theme Consistency, Console Errors

---

## Audit Legend

| Status | Meaning |
|--------|---------|
| `[ ]`  | Not audited |
| `[~]`  | In progress / partial |
| `[x]`  | Audited — clean |
| `[!]`  | Audited — issue found (see notes) |
| `[-]`  | N/A for this component |

---

## 1. PAGES

### 1.1 Root Layout & Providers
- [ ] `app/layout.tsx` — Root layout
- [ ] `app/app-providers.tsx` — Theme init, provider tree, fonts

### 1.2 Home / Runs (`/`)
- [ ] `app/page.tsx` — Dynamic imports, loading fallback
- [ ] `components/chat/runs-view.tsx` — PageHeader + ChatThread wrapper
- [ ] `components/chat/chat-thread.tsx` — Full chat UI (1169 lines)
  - [ ] Message list rendering
  - [ ] Composer with @mention
  - [ ] HumanInputPrompt (wizard questions)
  - [ ] ContextChips
  - [ ] ContextPicker dialog
  - [ ] ChatModelPicker
  - [ ] ReasoningEffortControl
  - [ ] RunActivityTimeline
  - [ ] InlineRunArtifacts
  - [ ] WelcomeScreen
  - [ ] Chat state restoration
- [ ] `components/chat/context-chips.tsx`
- [ ] `components/chat/context-picker.tsx`
- [ ] `components/chat/chat-mentions.tsx`
- [ ] `components/chat/tool-call.tsx`
- [ ] `components/chat/run-drawer.tsx`

### 1.3 Login (`/login`)
- [ ] `app/login/page.tsx`

### 1.4 Roles (`/roles`)
- [ ] `app/roles/page.tsx` — Sidebar, editor, inspector, contracts

### 1.5 Skills (`/skills`)
- [ ] `app/skills/page.tsx` — Sidebar, editor, inspector, tool bindings

### 1.6 Workflows (`/workflows`)
- [ ] `app/workflows/page.tsx`
- [ ] `components/workflows/graph-canvas.tsx`
- [ ] `components/workflows/node-inspector.tsx`
- [ ] `components/workflows/contract-flow.tsx`
- [ ] `components/workflows/pick-list.tsx`
- [ ] `components/workflows/edges/workflow-edge.tsx`
- [ ] `components/workflows/nodes/eval-node.tsx`
- [ ] `components/workflows/nodes/role-node.tsx`

### 1.7 Evals (`/evals`)
- [ ] `app/evals/page.tsx` — Sidebar, editor, criteria, retry policy, results

### 1.8 Strategy (`/strategy`)
- [ ] `app/strategy/page.tsx`

### 1.9 Knowledge/Files (`/knowledge`)
- [ ] `app/knowledge/page.tsx` — Tabbed: Library + Files
- [ ] `components/folder-file-browser.tsx`
- [ ] `components/document-editor.tsx`
- [ ] `components/prompt-editor.tsx`
- [ ] `components/google-drive-picker.tsx`
- [ ] `components/library-files-section.tsx`

### 1.10 Settings (`/settings`)
- [ ] `app/settings/page.tsx` — 5 tabs: models, connections, variables, workspace, theme

---

## 2. APP SHELL & NAVIGATION

- [ ] `components/app-shell.tsx` — Full-page layout, inspector resize, Cmd+K
- [ ] `components/nav-rail.tsx` — Left icon nav, active states, sections
- [ ] `components/org-switcher.tsx` — Workspace dropdown
- [ ] `components/inspector-toggle.tsx` — Inspector toggle button
- [ ] `components/command-palette.tsx` — Cmd+K palette, search, recent runs
- [ ] `components/memory-workspace.tsx` — Memory management

---

## 3. DESIGN SYSTEM COMPONENTS

### 3.1 Core Primitives
- [ ] `button.tsx` — 6 variants, 7 sizes, loading spinner
- [ ] `input.tsx` / `textarea.tsx` — Form inputs
- [ ] `switch.tsx` — Toggle switch
- [ ] `select.tsx` / `native-select.tsx` — Dropdowns
- [ ] `pill.tsx` — Badge/tag
- [ ] `field.tsx` / `kbd.tsx` / `divider.tsx`

### 3.2 Overlays
- [ ] `dialog.tsx` — Modal dialog system
- [ ] `confirm-dialog.tsx` — Confirm dialog
- [ ] `dropdown-menu.tsx` — Full dropdown system
- [ ] `popover.tsx` — Popover
- [ ] `tooltip.tsx` — Tooltip
- [ ] `command.tsx` — Command palette primitives

### 3.3 Layout
- [ ] `panel.tsx` — Card/panel
- [ ] `resizable-sidebar.tsx` — Draggable sidebar
- [ ] `sidebar-list-panel.tsx` — Sidebar list wrapper
- [ ] `inspector.tsx` — Inspector panel system
- [ ] `page-header.tsx` — Page header bar
- [ ] `nav-tabs.tsx` — Tab bar
- [ ] `tabs.tsx` — Tab system
- [ ] `list-item.tsx` — Clickable list item
- [ ] `empty-state.tsx` — Empty placeholder
- [ ] `notice.tsx` — Alert banner

### 3.4 Feedback
- [ ] `status-icon.tsx` — Status indicator + busy spinner
- [ ] `app-toaster.tsx` — Toast notifications
- [ ] `toggle-row.tsx` — Label + switch row
- [ ] `choice-button.tsx` — Radio/checkbox button

### 3.5 Icons & Theming
- [ ] `icon-registry.tsx` — Icon mapping
- [ ] `icons.tsx` — Icon component
- [ ] `icon-constants.ts` — Semantic icon maps
- [ ] `theme-toggle.tsx` — Theme cycle button

### 3.6 Missing Components (TO CREATE)
- [ ] `skeleton.tsx` — Unified skeleton primitive
- [ ] `spinner.tsx` — Unified spinner primitive

---

## 4. STYLING & TOKENS

### 4.1 Token Files
- [ ] `tokens/index.css` — Token entrypoint
- [ ] `tokens/tokens.json` — Machine-readable manifest
- [ ] `styles/base.css` — Global base + keyframe animations

### 4.2 Theme Palettes (8 themes)
- [ ] `gruvbox-dark.css` + `semantic-gruvbox-dark.css`
- [ ] `gruvbox-light.css` + `semantic-gruvbox-light.css`
- [ ] `monochrome-dark.css` + `semantic-monochrome-dark.css`
- [ ] `monochrome-light.css` + `semantic-monochrome-light.css`
- [ ] `blue-dark.css` + `semantic-blue-dark.css`
- [ ] `blue-light.css` + `semantic-blue-light.css`
- [ ] `discord-dark.css` + `semantic-discord-dark.css`
- [ ] `discord-light.css` + `semantic-discord-light.css`

### 4.3 Layout Constants
- [ ] `layout-constants.ts` — Sidebar widths

### 4.4 Hooks
- [ ] `use-theme.ts` — Theme management
- [ ] `use-dirty.ts` — Form dirty state

---

## 5. LOADING/SKELETON AUDIT

### Current Loading Patterns Found
| Pattern | Location | Issue |
|---------|----------|-------|
| `Icon name="loader" animate-spin` | Button loading, StatusIcon busy, toasts, GoogleDrivePicker | No unified spinner component |
| `animate-pulse` divs | MemoryWorkspace only | Ad-hoc, not a component |
| "Loading..." text | Home page dynamic import fallback | Text-only, no skeleton |
| "Loading..." text | Login page session check | Text-only, no skeleton |
| Button `loading` prop | Roles, Skills, Workflows, Evals, Settings | Works but no skeleton for content |

### Pages Missing Skeletons
- [ ] `/` — RunsView loading fallback needs skeleton
- [ ] `/roles` — Sidebar + editor need skeleton on load
- [ ] `/skills` — Sidebar + editor need skeleton on load
- [ ] `/workflows` — Sidebar + graph canvas need skeleton on load
- [ ] `/evals` — Sidebar + editor need skeleton on load
- [ ] `/strategy` — Folder browser needs skeleton on load
- [ ] `/knowledge` — Both tabs need skeleton on load
- [ ] `/settings` — All 5 tabs need skeleton on load
- [ ] `/login` — Session check needs skeleton (not just text)
- [ ] Command palette — Search results need skeleton
- [ ] Context picker — File list needs skeleton
- [ ] Google Drive picker — File list needs skeleton

---

## 6. ISSUES LOG

| # | Page/Component | Issue | Severity | Fix Applied | Verified |
|---|----------------|-------|----------|-------------|----------|
| | | | | | |

---

## 7. PASS HISTORY

| Pass | Date | Pages Checked | Issues Found | Issues Fixed |
|------|------|---------------|--------------|--------------|
| 1 | | | | |

---

## 8. SKELETON SYSTEM RULES

### Single Source of Truth
1. All skeletons MUST use `<Skeleton>` from `packages/design-system/src/components/skeleton.tsx`
2. All spinners MUST use `<Spinner>` from `packages/design-system/src/components/spinner.tsx`
3. No raw `animate-pulse` divs in app code
4. No inline `Icon name="loader" animate-spin` outside the Spinner component
5. Skeleton shapes must match the target component's final layout exactly
6. Use `--skeleton` CSS variable for the pulse color (theme-aware)
7. All skeleton animations use the design system `--duration-*` tokens

### Skeleton Shapes by Component Type
- **List item:** 1 line title (w-3/4 h-4) + 1 line subtitle (w-1/2 h-3)
- **Text block:** 3-4 lines of varying width (w-full, w-5/6, w-2/3, w-3/4)
- **Card/Panel:** Rectangle with rounded corners matching panel radius
- **Button:** Rectangle matching button dimensions
- **Avatar/Icon:** Circle or rounded square
- **Table row:** Cells with varying width placeholders

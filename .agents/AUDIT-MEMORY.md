# SpielOS UI Audit Memory

> This file is the single source of truth for the comprehensive UI audit.
> Updated continuously as each component/page is audited and fixed.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not yet audited |
| `[~]` | In progress |
| `[x]` | Audited + verified clean |
| `[!]` | Issue found, needs fix |
| `[F]` | Fix applied, needs re-verify |
| `[-]` | N/A (no loading/animation needed) |

## Issue Categories

- **BEH** = Behavior (clicks, states, interactions)
- **ANI** = Animation (transitions, motion, easing)
- **LOD** = Loading state (missing or inconsistent)
- **SKL** = Skeleton (missing or misaligned)
- **THR** = Theme consistency (hardcoded colors, token violations)
- **ERR** = Error handling (missing error states)
- **PERF** = Performance (unnecessary re-renders, jank)

---

## PHASE 1: Design System Foundation

### 1.1 Skeleton Component (TO BUILD)

- [ ] Create `Skeleton` primitive in `packages/design-system/src/components/skeleton.tsx`
- [ ] Export from design system `index.ts`
- [ ] Define skeleton animation tokens (pulse, shimmer)
- [ ] Define skeleton variant presets per component shape (text-line, avatar, card, sidebar-row, etc.)

### 1.2 Animation Tokens (TO AUDIT)

- [ ] `--duration-fast` (120ms) — used consistently?
- [ ] `--duration` (160ms) — used consistently?
- [ ] `--duration-slow` (240ms) — used consistently?
- [ ] `--ease` cubic-bezier(0.2, 0.8, 0.2, 1) — used consistently?
- [ ] `--motion-distance-sm` — used consistently?
- [ ] `--motion-scale-in` — used consistently?
- [ ] `prefers-reduced-motion` — respected everywhere?
- [ ] No hardcoded `transition-*` values outside design system?

### 1.3 Loading Patterns (TO STANDARDIZE)

Current inconsistent loading patterns found:
1. `"Loading run workbench..."` — plain text, no spinner (home + runs/[id])
2. `"Loading..."` — plain text (login)
3. `"Loading members..."` — plain text (settings)
4. `animate-spin` on ad-hoc div — inconsistent spinner markup (login)
5. Button `loading={saving}` — proper pattern (all pages)
6. Memory workspace `animate-pulse` — inline skeleton, not from design system

**Target**: All loading states use either:
- `<Skeleton>` primitives for content placeholders
- `<Button loading>` for action loading (already standard)
- `<StatusIcon busy />` for inline spinners (already exists)

---

## PHASE 2: Page-by-Page Audit

### 2.1 Root Layout (`app/layout.tsx`)

- [BEH] [x] Delegates to AppProviders
- [ANI] [-] No animations needed
- [LOD] [-] No loading state needed
- [THR] [-] No direct styling

### 2.2 AppProviders (`app/app-providers.tsx`)

- [BEH] [x] Theme hydration script works
- [ANI] [-] No animations
- [LOD] [-] No loading
- [THR] [-] Uses CSS variables

### 2.3 Root Page (`app/page.tsx`) — Route: `/`

- [BEH] [ ] AppShell renders correctly
- [BEH] [ ] RunsView loads and displays
- [BEH] [ ] RunDrawer opens/closes
- [ANI] [ ] Inspector panel slide animation
- [ANI] [ ] Command palette open/close
- [LOD] [!] `"Loading run workbench..."` — plain text, needs skeleton
- [SKL] [!] No skeleton for RunsView loading
- [THR] [-] Uses design tokens

### 2.4 Login Page (`app/login/page.tsx`) — Route: `/login`

- [BEH] [ ] Session check redirect works
- [BEH] [ ] Google sign-in button works
- [BEH] [ ] Loading spinner shows during sign-in
- [ANI] [-] animate-spin present
- [LOD] [!] `"Loading..."` plain text in Suspense fallback — needs skeleton
- [LOD] [!] `"Loading..."` plain text in form — needs skeleton
- [SKL] [!] No skeleton for login card
- [THR] [-] Uses design tokens

### 2.5 Roles Page (`app/roles/page.tsx`) — Route: `/roles`

- [BEH] [ ] Sidebar list renders all roles
- [BEH] [ ] Search filters roles
- [BEH] [ ] Create new role
- [BEH] [ ] Select role → editor populates
- [BEH] [ ] Edit fields (name, description, model, memory)
- [BEH] [ ] System prompt editor works
- [BEH] [ ] Inspector tabs (Skills, Input, Output)
- [BEH] [ ] Save button works (dirty detection)
- [BEH] [ ] Delete with confirmation
- [BEH] [ ] Enabled toggle works
- [BEH] [ ] Skill choice buttons toggle
- [BEH] [ ] Contract editor (add/remove fields)
- [ANI] [ ] Inspector open/close transition
- [ANI] [ ] ListItem hover transition
- [ANI] [ ] Button loading spinner animation
- [LOD] [!] No loading state for initial role list fetch
- [LOD] [-] Button loading states present
- [SKL] [!] No skeleton for sidebar list
- [SKL] [!] No skeleton for editor form
- [THR] [-] All tokens used correctly

### 2.6 Skills Page (`app/skills/page.tsx`) — Route: `/skills`

- [BEH] [ ] Sidebar list renders all skills
- [BEH] [ ] Search filters skills
- [BEH] [ ] Create new skill
- [BEH] [ ] Select skill → editor populates
- [BEH] [ ] Edit fields (name, description, enabled)
- [BEH] [ ] Instructions MentionTextarea works
- [BEH] [ ] Inspector shows tool bindings
- [BEH] [ ] Save/ delete works
- [BEH] [ ] Connection ChoiceButtons for tool binding
- [ANI] [ ] Inspector transitions
- [ANI] [ ] ListItem hover
- [LOD] [-] Button loading present
- [SKL] [!] No skeleton for sidebar list
- [SKL] [!] No skeleton for editor
- [THR] [-] All tokens

### 2.7 Strategy Page (`app/strategy/page.tsx`) — Route: `/strategy`

- [BEH] [ ] FolderFileBrowser renders
- [BEH] [ ] Folder tree expand/collapse
- [BEH] [ ] File selection works
- [BEH] [ ] PromptEditor renders
- [BEH] [ ] Markdown/JSON format toggle
- [BEH] [ ] Create/rename/delete files
- [BEH] [ ] Breadcrumb navigation
- [ANI] [ ] Folder expand/collapse rotation
- [ANI] [ ] Tree row hover transition
- [LOD] [!] No loading state for file fetch
- [SKL] [!] No skeleton for folder tree
- [SKL] [!] No skeleton for editor area
- [THR] [-] All tokens

### 2.8 Workflows Page (`app/workflows/page.tsx`) — Route: `/workflows`

- [BEH] [ ] Sidebar list renders workflows
- [BEH] [ ] Create new workflow
- [BEH] [ ] Select workflow → canvas + editor
- [BEH] [ ] Steps bar renders role/eval buttons
- [BEH] [ ] Drag to add nodes to canvas
- [BEH] [ ] ReactFlow canvas renders nodes/edges
- [BEH] [ ] Node selection → inspector opens
- [BEH] [ ] Node inspector fields work
- [BEH] [ ] Edge deletion works
- [BEH] [ ] Undo/redo (Cmd+Z / Cmd+Shift+Z)
- [BEH] [ ] Run workflow (SSE stream)
- [BEH] [ ] Run log display
- [BEH] [ ] Save/delete
- [ANI] [ ] ReactFlow fitView animation
- [ANI] [ ] Edge stroke transition
- [ANI] [ ] Inspector slide
- [LOD] [-] Button loading present
- [SKL] [!] No skeleton for sidebar
- [SKL] [!] No skeleton for canvas loading
- [THR] [-] All tokens

### 2.9 Evals Page (`app/evals/page.tsx`) — Route: `/evals`

- [BEH] [ ] Sidebar list renders evals
- [BEH] [ ] Create new eval
- [BEH] [ ] Select eval → editor populates
- [BEH] [ ] Edit fields (name, description, pass score, enabled)
- [BEH] [ ] Criteria rows (add/remove/reorder)
- [BEH] [ ] Criterion type selection (contains, equals, etc.)
- [BEH] [ ] Weight and threshold inputs
- [BEH] [ ] Test eval (SSE stream)
- [BEH] [ ] Results inspector
- [BEH] [ ] Score bar animation
- [BEH] [ ] Export/import JSON
- [BEH] [ ] Save/delete
- [BEH] [ ] Workflow retry policy section
- [BEH] [ ] Break condition chips
- [ANI] [ ] Score bar transition-all
- [ANI] [ ] Inspector transitions
- [LOD] [-] Button loading present
- [SKL] [!] No skeleton for sidebar
- [SKL] [!] No skeleton for editor
- [THR] [-] All tokens

### 2.10 Settings Page (`app/settings/page.tsx`) — Route: `/settings`

- [BEH] [ ] Tab switching (models, connections, variables, workspace, theme)
- [BEH] [ ] Models tab: list, create, edit, delete
- [BEH] [ ] Connections tab: presets grid, connect, disconnect
- [BEH] [ ] Variables tab: add/remove secrets
- [BEH] [ ] Theme tab: theme selector grid
- [BEH] [ ] Workspace tab: org details, team management
- [BEH] [ ] Invite/remove members
- [BEH] [ ] Reset/delete workspace
- [BEH] [ ] Confirm dialogs work
- [ANI] [ ] Tab transitions
- [ANI] [ ] Theme toggle animation
- [LOD] [!] `"Loading members..."` plain text — needs skeleton
- [LOD] [-] Button loading present
- [SKL] [!] No skeleton for model list
- [SKL] [!] No skeleton for connections list
- [SKL] [!] No skeleton for members list
- [SKL] [!] No skeleton for variables list
- [THR] [-] All tokens

### 2.11 Knowledge/Files Page (`app/knowledge/page.tsx`) — Route: `/knowledge`

- [BEH] [ ] Tab switching (Library, Files)
- [BEH] [ ] Library tab: FolderFileBrowser works
- [BEH] [ ] Files tab: Google Drive picker works
- [BEH] [ ] File selection and editing
- [ANI] [ ] Tab transitions
- [LOD] [!] No loading state for Drive connection check
- [LOD] [!] No loading state for file listing
- [SKL] [!] No skeleton for library tree
- [SKL] [!] No skeleton for Drive file list
- [THR] [-] All tokens

### 2.12 Run Detail Page (`app/runs/[id]/page.tsx`) — Route: `/runs/[id]`

- [BEH] [ ] Run loads by ID
- [BEH] [ ] ChatThread renders
- [BEH] [ ] RunDrawer shows run details
- [ANI] [-] Same as home page
- [LOD] [!] `"Loading run workbench..."` plain text — needs skeleton
- [SKL] [!] No skeleton for run loading
- [THR] [-] All tokens

---

## PHASE 3: Component Audit

### 3.1 App Shell (`components/app-shell.tsx`)

- [BEH] [ ] Inspector open/close toggle
- [BEH] [ ] Inspector resize drag
- [BEH] [ ] Cmd+K opens command palette
- [BEH] [ ] Resize handle works on drag
- [BEH] [ ] Keyboard resize (arrows, Home, End)
- [ANI] [ ] Inspector width transition (`--duration-slow`)
- [ANI] [ ] Overlay backdrop blur
- [ANI] [ ] Resize handle color transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.2 Nav Rail (`components/nav-rail.tsx`)

- [BEH] [ ] All nav links work
- [BEH] [ ] Active state highlights current route
- [BEH] [ ] Search button opens Cmd+K
- [BEH] [ ] Theme toggle works
- [BEH] [ ] Settings link works
- [BEH] [ ] OrgSwitcher dropdown works
- [ANI] [ ] Hover color transitions
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.3 SidebarListPanel (design-system)

- [BEH] [ ] List renders items
- [BEH] [ ] Search filters
- [BEH] [ ] New button works
- [BEH] [ ] Count pill updates
- [BEH] [ ] Scroll behavior
- [ANI] [-] No explicit animations
- [LOD] [ ] `newBusy` prop works
- [SKL] [-] No skeleton (will be added at page level)
- [THR] [-] All tokens

### 3.4 Button (design-system)

- [BEH] [ ] All variants render correctly
- [BEH] [ ] All sizes render correctly
- [BEH] [ ] Loading state disables + shows spinner
- [BEH] [ ] asChild composition works
- [ANI] [ ] Color transition on hover
- [ANI] [ ] Spinner animate-spin
- [LOD] [-] Loading prop handled
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens via CVA

### 3.5 ChatThread (`components/chat/chat-thread.tsx`)

- [BEH] [ ] Composer renders
- [BEH] [ ] Send message works
- [BEH] [ ] Cancel running request works
- [BEH] [ ] User messages render
- [BEH] [ ] Assistant messages render with markdown
- [BEH] [ ] Action bar (copy/regenerate/edit)
- [BEH] [ ] Model picker works
- [BEH] [ ] Reasoning effort control works
- [BEH] [ ] Context chips render
- [BEH] [ ] Human input prompt works
- [BEH] [ ] Run activity timeline renders
- [BEH] [ ] Inline artifacts render
- [BEH] [ ] Welcome screen shows
- [BEH] [ ] @ mention dropdown works
- [BEH] [ ] Edit composer works
- [ANI] [ ] Message fade-in + slide-up animation
- [ANI] [ ] Action bar opacity transition
- [ANI] [ ] Artifact expand chevron rotation
- [ANI] [ ] Loader spinner
- [LOD] [-] isRunning toggle works
- [SKL] [-] No skeleton needed (messages stream in)
- [THR] [-] All tokens

### 3.6 RunDrawer (`components/chat/run-drawer.tsx`)

- [BEH] [ ] Context tab renders
- [BEH] [ ] Events tab renders
- [BEH] [ ] Output tab renders
- [BEH] [ ] Runtime capacity meter renders
- [BEH] [ ] Event timeline renders
- [BEH] [ ] Tool call cards expand
- [BEH] [ ] Artifact cards render
- [BEH] [ ] Control buttons (pause/cancel/resume/retry)
- [BEH] [ ] Control busy state
- [ANI] [ ] Event row hover
- [ANI] [ ] Loader spinner
- [LOD] [-] controlBusy handled
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.7 FolderFileBrowser (`components/folder-file-browser.tsx`)

- [BEH] [ ] Folder tree renders
- [BEH] [ ] Expand/collapse folders
- [BEH] [ ] Inline rename
- [BEH] [ ] Context menus work
- [BEH] [ ] Search filters
- [BEH] [ ] Create/rename/delete operations
- [BEH] [ ] Breadcrumb navigation
- [BEH] [ ] Editor renders via renderEditor prop
- [BEH] [ ] Metadata fields render
- [BEH] [ ] Status/folder selects work
- [ANI] [ ] Folder row hover transition
- [ANI] [ ] Chevron rotation on expand
- [ANI] [ ] Tree menu opacity transition
- [LOD] [-] Uses workspace store data
- [SKL] [-] No skeleton (will be added at page level)
- [THR] [-] All tokens

### 3.8 MentionTextarea (`components/mention-textarea.tsx`)

- [BEH] [ ] Text input works
- [BEH] [ ] @ trigger detection works
- [BEH] [ ] Dropdown positioning works
- [BEH] [ ] Keyboard navigation in dropdown
- [BEH] [ ] Mention insertion works
- [BEH] [ ] Portal rendering works
- [ANI] [-] No animations (dropdown from MentionDropdown)
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.9 MentionDropdown (`components/mention-dropdown.tsx`)

- [BEH] [ ] Groups render by kind
- [BEH] [ ] Keyboard navigation (arrows, enter, tab, escape)
- [BEH] [ ] Filtering works
- [BEH] [ ] Item selection works
- [ANI] [ ] Option hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.10 DocumentEditor (`components/document-editor.tsx`)

- [BEH] [ ] TipTap editor renders
- [BEH] [ ] Toolbar buttons work (H1, H2, Bold, Italic, List, Quote)
- [BEH] [ ] Content editing works
- [BEH] [ ] @ mention support
- [BEH] [ ] immediateRender: false (no SSR flash)
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.11 CommandPalette (`components/command-palette.tsx`)

- [BEH] [ ] Opens on Cmd+K
- [BEH] [ ] Search filters entries
- [BEH] [ ] Navigate entries work
- [BEH] [ ] New Run action works
- [BEH] [ ] Last Runs fetched and displayed
- [BEH] [ ] Keyboard shortcuts shown in footer
- [ANI] [-] Dialog animation from design system
- [LOD] [!] No loading indicator while fetching runs
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.12 GoogleDrivePicker (`components/google-drive-picker.tsx`)

- [BEH] [ ] Connect screen shows when disconnected
- [BEH] [ ] File listing works
- [BEH] [ ] Search works
- [BEH] [ ] File detail preview
- [BEH] [ ] Import to workspace works
- [BEH] [ ] Open in Drive works
- [BEH] [ ] Resizable sidebar
- [ANI] [ ] animate-spin on loaders
- [LOD] [x] Loading states present
- [SKL] [!] No skeleton for file list
- [THR] [-] All tokens

### 3.13 MemoryWorkspace (`components/memory-workspace.tsx`)

- [BEH] [ ] Memory list renders
- [BEH] [ ] Memory detail editor works
- [BEH] [ ] CRUD operations work
- [BEH] [ ] Stats dashboard renders
- [BEH] [ ] Confirm delete works
- [ANI] [ ] animate-pulse on skeleton (inline)
- [LOD] [x] Loading state present
- [SKL] [!] Inline skeleton — should use design system Skeleton
- [THR] [-] All tokens

### 3.14 OrgSwitcher (`components/org-switcher.tsx`)

- [BEH] [ ] Dropdown opens
- [BEH] [ ] Workspace switching works
- [BEH] [ ] New workspace creation
- [BEH] [ ] Workspace settings link
- [ANI] [ ] Color transition on trigger
- [LOD] [-] switching/creating states
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.15 ChatModelPicker (`components/chat-model-picker.tsx`)

- [BEH] [ ] Popover opens
- [BEH] [ ] Models grouped by provider
- [BEH] [ ] Context window display
- [BEH] [ ] Model selection works
- [BEH] [ ] Currently selected highlighted
- [ANI] [ ] Chevron rotation
- [ANI] [ ] Model button hover
- [ANI] [ ] Check icon opacity
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.16 ReasoningEffortControl (`components/reasoning-effort-control.tsx`)

- [BEH] [ ] Popover opens
- [BEH] [ ] Slider drag works
- [BEH] [ ] Level buttons work
- [BEH] [ ] Fill bar tracks value
- [BEH] [ ] Spark animations at Max
- [ANI] [ ] Slider fill surge animation
- [ANI] [ ] Spark keyframe animations
- [ANI] [ ] Electric ring pulsing
- [ANI] [x] prefers-reduced-motion respected
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.17 ContextPicker (`components/chat/context-picker.tsx`)

- [BEH] [ ] Dialog opens
- [BEH] [ ] Section navigation works
- [BEH] [ ] Item listing per section
- [BEH] [ ] Attach/detach items
- [BEH] [ ] Conflict detection (workflow exclusivity)
- [BEH] [ ] Attached count per section
- [ANI] [-] Dialog animation from design system
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.18 ContextChips (`components/chat/context-chips.tsx`)

- [BEH] [ ] Chips render with icons
- [BEH] [ ] Remove button works
- [BEH] [ ] Chip layout wraps correctly
- [ANI] [ ] Chip hover transition
- [ANI] [ ] Remove button hover
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 3.19 ToolCallCard (`components/chat/tool-call.tsx`)

- [BEH] [ ] Card renders with status
- [BEH] [ ] Expand/collapse works
- [BEH] [ ] Params/result display
- [BEH] [ ] Skill name badge
- [BEH] [ ] Parallel count badge
- [ANI] [-] No animations
- [LOD] [-] Active prop handles busy state
- [SKL] [-] No skeleton needed
- [THR] [!] `text-foreground/80` — uses opacity, verify token compliance

### 3.20 RunsView (`components/chat/runs-view.tsx`)

- [BEH] [ ] PageHeader renders with counts
- [BEH] [ ] ChatThread renders below
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

---

## PHASE 4: Design System Components

### 4.1 Dialog (design-system)

- [BEH] [ ] Open/close works
- [BEH] [ ] Overlay click closes
- [BEH] [ ] Escape key closes
- [BEH] [ ] Focus trap works
- [BEH] [ ] Three layout variants work
- [ANI] [x] motion-overlay, motion-dialog animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.2 Popover (design-system)

- [BEH] [ ] Open/close works
- [BEH] [ ] Anchor positioning
- [BEH] [ ] Escape/focus-outside closes
- [ANI] [x] motion-popover animation
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.3 DropdownMenu (design-system)

- [BEH] [ ] Open/close works
- [BEH] [ ] Item selection
- [BEH] [ ] Checkbox items
- [BEH] [ ] Sub-menus
- [BEH] [ ] Keyboard navigation
- [ANI] [ ] Item hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.4 Tabs (design-system)

- [BEH] [ ] Tab switching
- [BEH] [ ] Keyboard navigation
- [BEH] [ ] Content panels
- [ANI] [ ] Trigger hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.5 Switch (design-system)

- [BEH] [ ] Toggle works
- [BEH] [ ] Three sizes
- [BEH] [ ] Disabled state
- [ANI] [x] Track + thumb transitions
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.6 Pill (design-system)

- [BEH] [ ] All tones render
- [BEH] [ ] Remove button works
- [ANI] [ ] Hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.7 Notice (design-system)

- [BEH] [ ] All tones render
- [BEH] [ ] Status icon shows
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.8 EmptyState (design-system)

- [BEH] [ ] Icon, title, description, action render
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.9 StatusIcon (design-system)

- [BEH] [ ] All tones render
- [BEH] [ ] Busy spinner works
- [ANI] [x] animate-spin on busy
- [LOD] [-] Busy prop handled
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.10 ConfirmDialog (design-system)

- [BEH] [ ] Open/close
- [BEH] [ ] Confirm/cancel
- [BEH] [ ] Busy state disables
- [BEH] [ ] Destructive/warning tones
- [ANI] [-] Dialog animation from Dialog
- [LOD] [-] busy prop handled
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.11 Input/Textarea (design-system)

- [BEH] [ ] Text input works
- [BEH] [ ] Textarea auto-resize
- [BEH] [ ] Ghost variant
- [BEH] [ ] Disabled state
- [ANI] [ ] Focus border transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.12 Select/NativeSelect (design-system)

- [BEH] [ ] Selection works
- [BEH] [ ] Disabled state
- [BEH] [ ] Keyboard navigation
- [ANI] [ ] Trigger hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.13 ListItem (design-system)

- [BEH] [ ] Icon, title, subtitle, metadata render
- [BEH] [ ] Active/inactive states
- [BEH] [ ] Click selection
- [ANI] [ ] Hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.14 ActionRow (design-system)

- [BEH] [ ] Icon, title, description, trailing render
- [BEH] [ ] Click works
- [BEH] [ ] Disabled state
- [ANI] [ ] Hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.15 Inspector (design-system)

- [BEH] [ ] Header renders
- [BEH] [ ] Tabs switch
- [BEH] [ ] Body scrolls
- [BEH] [ ] Sections divide
- [BEH] [ ] Footer renders
- [BEH] [ ] Empty state shows
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.16 ResizableSidebar (design-system)

- [BEH] [ ] Drag resize works
- [BEH] [ ] Keyboard resize (arrows, Home/End)
- [BEH] [ ] localStorage persistence
- [BEH] [ ] Responsive max-width
- [BEH] [ ] Min/max bounds
- [ANI] [ ] Handle hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.17 Field/Kbd/Divider/VisuallyHidden (design-system)

- [BEH] [ ] Label + hint render
- [BEH] [ ] Kbd renders styled shortcut
- [BEH] [ ] Divider renders hr
- [BEH] [ ] VisuallyHidden is accessible
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.18 ChoiceButton (design-system)

- [BEH] [ ] Radio/checkbox/press modes
- [BEH] [ ] Selection works
- [BEH] [ ] Leading/trailing slots
- [BEH] [ ] Disabled state
- [ANI] [ ] Hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.19 SearchInput (design-system)

- [BEH] [ ] Search icon shows
- [BEH] [ ] Input works
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.20 ThemeToggle (design-system)

- [BEH] [ ] Toggle dark/light
- [BEH] [ ] Icon changes sun/moon
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.21 ToggleRow (design-system)

- [BEH] [ ] Switch toggles
- [BEH] [ ] Label clickable
- [BEH] [ ] Description shows
- [BEH] [ ] Disabled state
- [ANI] [ ] Transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.22 AppToaster (design-system)

- [BEH] [ ] Toasts appear
- [BEH] [ ] Success/error/warning/info tones
- [BEH] [ ] Loading toasts
- [BEH] [ ] Dismiss works
- [ANI] [-] Sonner handles animation
- [LOD] [-] Loading toast handled
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.23 Tooltip (design-system)

- [BEH] [ ] Shows on hover
- [BEH] [ ] Positioning works
- [BEH] [ ] Delay works
- [ANI] [-] Radix default animation
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.24 Panel (design-system)

- [BEH] [ ] Header, body, footer render
- [BEH] [ ] Shadow shows
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.25 PageHeader (design-system)

- [BEH] [ ] Icon, title, actions render
- [BEH] [ ] Children slot works
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.26 NavTabs (design-system)

- [BEH] [ ] Tab switching
- [BEH] [ ] Icon + label render
- [ANI] [ ] Hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 4.27 Command (design-system)

- [BEH] [ ] Input works
- [BEH] [ ] List filters
- [BEH] [ ] Groups render
- [BEH] [ ] Items selectable
- [BEH] [ ] Empty state shows
- [ANI] [ ] Item hover transition
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

---

## PHASE 5: Workflow Co-located Components

### 5.1 GraphCanvas (`app/workflows/graph-canvas.tsx`)

- [BEH] [ ] ReactFlow renders
- [BEH] [ ] Nodes draggable
- [BEH] [ ] Edges connect
- [BEH] [ ] Drag-and-drop from steps bar
- [BEH] [ ] Controls/MiniMap render
- [BEH] [ ] Background grid renders
- [BEH] [ ] Empty state shows
- [ANI] [ ] fitView duration: 200ms
- [LOD] [-] Uses workspace data
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 5.2 NodeInspector (`app/workflows/node-inspector.tsx`)

- [BEH] [ ] Inspector renders for selected node
- [BEH] [ ] Fields work (name, instructions, etc.)
- [BEH] [ ] ContractFlow renders
- [BEH] [ ] PickList renders
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 5.3 RoleNode (`app/workflows/nodes/role-node.tsx`)

- [BEH] [ ] Node renders with role info
- [BEH] [ ] Handle connects
- [BEH] [ ] Delete button works
- [ANI] [ ] transition-colors
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 5.4 EvalNode (`app/workflows/nodes/eval-node.tsx`)

- [BEH] [ ] Node renders with eval info
- [BEH] [ ] Handle connects
- [BEH] [ ] Delete button works
- [ANI] [ ] transition-colors
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 5.5 WorkflowEdge (`app/workflows/edges/workflow-edge.tsx`)

- [BEH] [ ] Edge renders
- [BEH] [ ] Delete button works
- [BEH] [ ] Hit-test path works
- [ANI] [ ] stroke transition: 120ms ease
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 5.6 ContractFlow (`app/workflows/contract-flow.tsx`)

- [BEH] [ ] Contract visualization renders
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

### 5.7 PickList (`app/workflows/pick-list.tsx`)

- [BEH] [ ] List renders items
- [BEH] [ ] Selection works
- [BEH] [ ] Search filters
- [ANI] [-] No animations
- [LOD] [-] No loading needed
- [SKL] [-] No skeleton needed
- [THR] [-] All tokens

---

## PHASE 6: Lib Utilities

### 6.1 Workspace Store (`lib/use-workspace-store.ts`)

- [BEH] [ ] Composite store initializes
- [BEH] [ ] CRUD operations work
- [LOD] [-] No loading needed (React state)

### 6.2 Run Context (`lib/run-context.tsx`)

- [BEH] [ ] Run state management
- [BEH] [ ] Event tracking
- [BEH] [ ] Artifact tracking
- [LOD] [-] No loading needed

### 6.3 Chat Adapter (`lib/chat-adapter.ts`)

- [BEH] [ ] SSE stream parsing
- [BEH] [ ] Error handling
- [LOD] [-] No loading needed

### 6.4 Run Events (`lib/run-events.ts`)

- [BEH] [ ] Event ordering
- [BEH] [ ] Event classification
- [BEH] [ ] Event compaction
- [LOD] [-] No loading needed

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total components audited | 0 / 72 |
| Total issues found | 0 |
| Total fixes applied | 0 |
| Skeletons created | 0 / TBD |
| Pages with skeleton loading | 0 / 9 |
| Animation inconsistencies | TBD |
| Theme violations | TBD |

---

## Issue Log

| # | Component | Category | Description | Status |
|---|-----------|----------|-------------|--------|
| 1 | `app/page.tsx` | LOD | Plain text "Loading run workbench..." — needs skeleton | OPEN |
| 2 | `app/login/page.tsx` | LOD | Plain text "Loading..." — needs skeleton | OPEN |
| 3 | `app/login/page.tsx` | SKL | No skeleton for login card | OPEN |
| 4 | `app/roles/page.tsx` | SKL | No skeleton for sidebar list | OPEN |
| 5 | `app/roles/page.tsx` | SKL | No skeleton for editor form | OPEN |
| 6 | `app/skills/page.tsx` | SKL | No skeleton for sidebar list | OPEN |
| 7 | `app/skills/page.tsx` | SKL | No skeleton for editor | OPEN |
| 8 | `app/strategy/page.tsx` | LOD | No loading state for file fetch | OPEN |
| 9 | `app/strategy/page.tsx` | SKL | No skeleton for folder tree | OPEN |
| 10 | `app/strategy/page.tsx` | SKL | No skeleton for editor area | OPEN |
| 11 | `app/workflows/page.tsx` | SKL | No skeleton for sidebar | OPEN |
| 12 | `app/workflows/page.tsx` | SKL | No skeleton for canvas loading | OPEN |
| 13 | `app/evals/page.tsx` | SKL | No skeleton for sidebar | OPEN |
| 14 | `app/evals/page.tsx` | SKL | No skeleton for editor | OPEN |
| 15 | `app/settings/page.tsx` | LOD | Plain text "Loading members..." — needs skeleton | OPEN |
| 16 | `app/settings/page.tsx` | SKL | No skeleton for model list | OPEN |
| 17 | `app/settings/page.tsx` | SKL | No skeleton for connections list | OPEN |
| 18 | `app/settings/page.tsx` | SKL | No skeleton for members list | OPEN |
| 19 | `app/settings/page.tsx` | SKL | No skeleton for variables list | OPEN |
| 20 | `app/knowledge/page.tsx` | LOD | No loading state for Drive connection | OPEN |
| 21 | `app/knowledge/page.tsx` | LOD | No loading state for file listing | OPEN |
| 22 | `app/knowledge/page.tsx` | SKL | No skeleton for library tree | OPEN |
| 23 | `app/knowledge/page.tsx` | SKL | No skeleton for Drive file list | OPEN |
| 24 | `app/runs/[id]/page.tsx` | LOD | Plain text "Loading run workbench..." — needs skeleton | OPEN |
| 25 | `app/runs/[id]/page.tsx` | SKL | No skeleton for run loading | OPEN |
| 26 | `components/command-palette.tsx` | LOD | No loading indicator while fetching runs | OPEN |
| 27 | `components/memory-workspace.tsx` | SKL | Inline skeleton — should use design system Skeleton | OPEN |
| 28 | `components/google-drive-picker.tsx` | SKL | No skeleton for file list | OPEN |
| 29 | `components/chat/tool-call.tsx` | THR | `text-foreground/80` — opacity usage, verify compliance | OPEN |
| 30 | Design System | SKL | No Skeleton primitive exists — NEEDS BUILDING | OPEN |

---

## Skeleton Blueprint

### Design System Skeleton Component

```tsx
// packages/design-system/src/components/skeleton.tsx
// Variants: text, circle, rectangle, card, sidebar-row
// All use --duration pulse animation
// All respect prefers-reduced-motion
// All use design system tokens (bg-panel-raised, etc.)
```

### Per-Page Skeleton Patterns

| Page | Skeleton Pattern |
|------|-----------------|
| Home / Runs | Chat message skeleton (3-4 message bubbles alternating) |
| Login | Centered card skeleton (logo circle + 2 text lines + button) |
| Roles | Sidebar: 6 list item skeletons; Editor: form field skeletons |
| Skills | Sidebar: 6 list item skeletons; Editor: form field skeletons |
| Strategy | Folder tree: 5 tree row skeletons; Editor: text area skeleton |
| Workflows | Sidebar: 4 list item skeletons; Canvas: 2 node skeletons |
| Evals | Sidebar: 4 list item skeletons; Editor: form + criteria skeletons |
| Settings | Per-tab: list skeletons (models, connections, members, variables) |
| Knowledge | Library: tree skeleton; Files: file list skeleton |
| Runs/[id] | Same as Home |

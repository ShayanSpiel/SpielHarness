# Harness Create Draft

Propose a new role, skill, workflow, eval, or template as an editable draft.

## Safety contract

- Creates only `draft` records; it never activates executable harness content.
- Use `fileType` values `harness_role`, `harness_skill`, `harness_workflow`, `harness_eval`, or `harness_template`.
- Put executable structure in metadata using the same file-backed schema used by the editors.
- Return the created id and version so later steps can reference the proposal.

## Input

Provide `title`, `fileType`, `body`, and optional `metadata`.

## Output

The draft id, title, type, status, and current version.

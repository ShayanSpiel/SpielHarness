# Run Workbench

Chat is the primary run surface and works as an ordinary assistant without selected harness context. Roles, skills, evals, files, and workflows are optional execution context.

## Chat presentation

- Model text is the assistant answer.
- Plain chat shows a quiet inline thinking state only while lifecycle status is `running`.
- Executable runs show compact inline activity rows derived from native events.
- Start/completion pairs are compacted by node, skill, or tool identity.
- The active assistant avatar/name changes to the role carried by the current event.
- Runtime events never appear as Markdown or as a bordered text transcript.
- Human-input questions are interactive run controls, not assistant prose.

## Inspector

The right inspector uses three equal-width design-system tabs:

- Context: selected execution target and attached files.
- Events: complete ordered event history.
- Outputs: generated artifacts linked to the run.

The inspector toggle contains no live/idle status. Loading indicators render only for `running`; terminal and waiting states must be visually stable.

## Human input

`human_input_requested` opens an anchored dialog immediately above the shared composer; it is not inserted as a chat message. Text and custom answers use the composer. Structured `single` and `multi` questions use shared choice controls with Back, Next, and Confirm navigation. Terminal states always dismiss the dialog, and a resumed checkpoint must not re-emit the request that was just answered.

Question text and options arrive as the typed `HumanInputRequest` emitted by the graph. Explicit file-backed `WorkflowNode.humanQuestions` or skill `humanQuestions` are preferred; the graph provides a compatibility conversion for legacy prompt-authored choices. The UI never derives wizard state by parsing prompt prose.

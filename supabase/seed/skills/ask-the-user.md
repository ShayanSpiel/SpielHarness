# Ask the User

A human-in-the-loop skill. It emits a typed `HumanInputRequest`, checkpoints the graph in `waiting_human`, and resumes only after the matching request id is answered.

## Question contract

Questions are file-backed on the workflow node or skill as `humanQuestions`. The supported kinds are:

- `single` — one radio choice.
- `multi` — one or more checkbox choices.
- `text` — a composer answer.
- `none` — an acknowledgement step with no answer value.

Each structured question may define `options`, `allowCustom`, and a custom-answer `placeholder`. Two or more questions render as a Back/Next/Confirm wizard. Yes/no confirmation is a `single` question with explicit options; `confirm` is not a separate kind.

## Authoring rules

- Put production question text, option ids, labels, descriptions, and kinds in `humanQuestions`; do not ask the client to parse prompt prose.
- Use stable semantic ids because answers are persisted by question id and option id.
- Use `single` for mutually exclusive decisions and `multi` only when combinations are valid.
- Set `allowCustom` when the composer should accept an alternative answer.
- Split additional details into a second `text` question so the runtime produces a wizard.
- Keep choices concise; descriptions explain impact or reversibility when needed.
- Never emit a fake answer, completion, or tool result while the run is waiting.

Legacy `Suggest: (A)…` prompts are converted into the typed contract by the LangGraph boundary for compatibility, but new and edited workflows must author `humanQuestions` directly.

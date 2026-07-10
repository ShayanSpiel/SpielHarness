# Ask the User

A human-in-the-loop skill. Pauses the run and asks the user a question (or set of questions) in the chat. Use this to confirm direction, gather a missing detail, or offer a choice between A/B/C options.

## How to use
Add this skill to a role or to a workstream step. In the role's prompt, instruct the agent on what to ask. Example:

> After you finish the draft, use the "Ask the user" skill to confirm which option to publish.

## Question kinds
- `single` — pick one option
- `multi` — pick many options
- `text` — write your own answer
- `none` — just emit a message, no answer needed

## Example questions
- "Which headline do you want to ship?" (single, 3 options)
- "Which platforms should we post to?" (multi, 4 options)
- "What's the launch date?" (text)
- "All drafts ready." (none)

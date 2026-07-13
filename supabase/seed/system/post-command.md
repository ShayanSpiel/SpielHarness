# Post Command

Routes a topic, session, or user prompt through the content pipeline.

1. Researcher: gather context and signals for the topic
2. Human Check: ask what formats to generate (X, LinkedIn, Blog, or all)
3. Strategist: create the 6-field strategy brief with ICP simulation
4. Writer: write platform-native drafts from the brief
5. Editor: run mechanical gates + grounding check
6. Human Check: ask which drafts to publish and where
7. Publisher: build publish package and dispatch

## Runtime contract

- This file describes dependency order; the saved workflow graph remains authoritative for execution.
- The runtime emits node, skill, tool, evaluation, artifact, human-input, and terminal events. Do not restate those events as assistant prose.
- Human checks transition the run from `running` to `waiting_human`. A submitted answer returns it to `running`; rejection or cancellation must not dispatch side effects.
- `completed` means the graph reached a successful terminal state. Tool errors, failed evaluation gates, and missing required outputs must not be reported as completion.
- Ordinary conversation without this command or another executable target remains a normal assistant chat.

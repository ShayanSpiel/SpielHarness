# Memory Propose

Propose a distilled fact, decision, lesson, preference, or run outcome for cross-session memory.

## Use sparingly

- Propose only information likely to remain useful beyond the current conversation.
- Do not store raw transcripts, secrets, temporary tool output, or facts already represented by workspace configuration.
- Prefer semantic memory for durable facts and decisions; use episodic memory for notable run outcomes.
- Include a clear reason and realistic confidence.

## Control model

The tool creates a `proposed` record only. It is excluded from retrieval until a user approves it in Strategy → Memory. Equivalent proposals are deduplicated, and possible contradictions are surfaced for review.

## Input

Provide `title`, `body`, optional `kind`, `scope`, `scopeId`, `reason`, `confidence`, and `supersedesId`.

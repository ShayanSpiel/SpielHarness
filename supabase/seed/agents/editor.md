# Editor

## Mission
Evaluate drafts for mechanical quality and strategic grounding before publishing.

## Skills
- Pipeline gate evaluator for mechanical checks
- Grounding evaluator for claim verification
- LLM generate for revision

## Steps
1. Read each draft
2. Run pipeline gates: frontmatter, banned phrases, em dashes, char limits
3. Run grounding check: claims vs proof, ICP language, Belief→Point contradiction
4. If gates or grounding fail: return specific fix notes
5. If all pass: mark drafts as ready

## Scoring
- Each gate: pass/fail per rubric
- Overall: weighted average of all rubrics
- Threshold: 75% to pass
- Below threshold: return with fix notes, not ready for publishing

## Runtime contract
- Emit evaluation content, not progress narration; eval events and artifacts are runtime-owned.
- A failed gate may route the workflow back to its configured retry source while attempts remain.
- Do not describe the run as `completed` when the score is below threshold or a required evaluator failed.

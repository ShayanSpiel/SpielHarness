# Template Picker

Picks the best template per platform from the template registry, ranked by archetype, axis, funnel stage, and ICP match.

## How it works
1. Reads the strategy brief's reader, pain, belief, point fields
2. Matches the Belief→Point shape to the archetype catalog
3. Picks top 3 templates per platform ranked by match score
4. Returns the best template per platform for the Writer

## Archetype match
| Belief→Point shape | Best template match |
|---|---|
| "I failed at X, the shift is Y" | Experiment log (example 1-4) |
| "Common belief X is wrong, real pattern is Y" | Contrarian / paradigm (example 5, 7) |
| "I struggled with X, the lesson is Y" | Vulnerability (example 6) |
| "You have problem X, the shift is Y" | Reader-problem first (example 8) |

## Output
Best template per platform with match reason.
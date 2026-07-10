# LangGraph Runtime

The runtime package owns graph execution and streaming contracts. The current implementation exposes `streamEvalRun`, backed by a LangGraph JS `StateGraph` with an `Editor` node. It emits the event types consumed by the web workbench:

- `node_started`
- `node_status`
- `eval_score_updated`
- `artifact_created`
- `node_completed`
- `run_completed`

The graph always runs mechanical checks from `@spielos/evals`. If `MISTRAL_API_KEY` is configured, the web API also passes a Mistral model config into the graph and the `Editor` node adds an LLM review to the eval artifact.

Environment variables:

- `MISTRAL_API_KEY`: enables the LLM review path.
- `MISTRAL_MODEL`: optional, defaults to `mistral-large-latest`.
- `MISTRAL_BASE_URL`: optional, defaults to `https://api.mistral.ai/v1`.

# SpielOS Positioning

## What We Are

SpielOS is a **file-backed, provider-agnostic operating system for AI marketing teams** — a customizable harness where every agent (role), skill, eval rubric, and workflow lives as editable data, not code.

## Why This Exists

Every marketing AI platform today is either:
- A **content generator** with rigid templates (Jasper, Copy.ai)
- A **CRM with AI bolted on** (Salesforce Agentforce, HubSpot Breeze)
- A **general-purpose agent framework** with zero marketing concepts (CrewAI, AutoGen)
- A **proprietary model platform** that locks you in (ChatGPT, Claude)

None can do what SpielOS does because they are structurally unable to.

## The Three Things Nobody Else Does

### 1. File-Backed Agent Definitions

Every role, skill, eval, and workflow is a row in the `files` table. To add a new agent type, create a seed file — no code changes, no deploy, no developer required.

**Why they can't copy this:**
- Salesforce/HubSpot: agents are coupled to their CRM data model
- CrewAI/AutoGen: Python class mental model (`class WriterAgent(BaseAgent)`)
- OpenAI/Anthropic: proprietary platform with no custom agent definitions
- Jasper/Copy.ai: business model depends on managing complexity for you

### 2. Custom Roles as Editable Data

Roles (Researcher, Strategist, Writer, Editor, Publisher, Analyst) are DB rows with a system prompt, model selection, skill assignments, and I/O contracts. Edit any role at runtime through the UI — no deploy cycle, no code review.

**Competitors lock roles into:**
- Component classes (CrewAI, AutoGen)
- CRM-specific agent templates (Salesforce, HubSpot)
- Fixed product features (Jasper, Copy.ai)

### 3. Provider-Agnostic Runtime

The same workflow runs on Mistral, OpenAI, Anthropic, or any OpenAI-compatible endpoint. The LLM provider is a field on the role, not baked into the framework.

**Competitors enforce lock-in:**
- Salesforce → Salesforce models only
- Jasper → Jasper's fine-tuned models
- ChatGPT → OpenAI only
- Claude → Anthropic only

### Bonus: Evals as Workflow Gates

Weighted rubric rules (contains, missing, word count, regex, llm_judge) as first-class workflow steps with pass/fail/retry gates. No competitor has automated content quality evaluation as part of the pipeline.

## Positioning Statement (One Line)

> **SpielOS is the only AI marketing platform where every agent, skill, eval, and workflow is editable data — not hardcoded — and runs on any model provider.**

## Category

**Agentic Marketing OS** — the operating system layer between LLMs and marketing output. Not a content generator. Not a CRM add-on. Not a developer framework.

## Target ICP

Mid-market and enterprise marketing operations teams who:
- Run multi-channel content operations (blog, social, email, ads)
- Need consistent quality across high-volume output
- Want human oversight at key checkpoints (not a black box)
- Are frustrated by vendor lock-in model pricing
- Have outgrown Jasper (content only, no orchestration) and n8n (automation only, no AI agents)

## Key Differentiators (Bullet)

- **Your marketing team, as data** — roles, skills, evals, workflows are editable rows, not code
- **Multi-agent content pipeline** — not a single AI writer, but a team (Researcher → Strategist → Writer → Editor → Publisher) with eval gates between each
- **Bring your own model** — run on any provider, switch anytime
- **Human in the loop** — pause at any step, review, redirect, resume
- **Open architecture** — extend with custom skill kinds, provider adapters, and connection types

## Competitive Threats to Watch

- Salesforce Agentforce Marketing is the closest category competitor (multi-agent marketing orchestration with Content Agent + Goals Agent)
- CrewAI adding marketing templates could close the gap
- Jasper adding multi-agent orchestration on top of their content engine
- n8n AI features getting deeper with MCP support

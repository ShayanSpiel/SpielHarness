-- Consolidate model providers: mistral and openai fold into openai-compatible.
-- Custom models with provider 'mistral' or 'openai' are migrated to 'openai-compatible'.

update models set provider = 'openai-compatible' where provider in ('mistral', 'openai');

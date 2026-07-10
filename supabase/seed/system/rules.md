# Pipeline Rules

## Draft platforms
- x: max_chars 280
- linkedin: max_chars 3000
- blog: max_words 2500

## Banned phrases
- "Like if you agree"
- "Share if this resonates"
- "Follow for more"

## Banned patterns
- em dashes, TOFU, MOFU, BOFU, S[0-9]+, ICP, core_insight

## Required frontmatter (11 fields)
title, created, platform, status, source, reader, pain, belief, point, meaning, proof

## Grounding config
- banned_words: test, tests, adapter, doctor, pipeline, shim, vault, IDE, git
- icp_markers: session, min, avg, duration, visitor, traffic, conversion, engagement
- point_offer_overlap_min: 0.15

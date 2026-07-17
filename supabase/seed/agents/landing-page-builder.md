# Landing Page Builder

## Mission

Create a production-shaped, premium HTML landing-page project from the approved strategy.

## Required project structure

- `index.html` — semantic, accessible landing page and form.
- `Assets/styles.css` — complete responsive visual system.
- `Assets/app.js` — progressive enhancement, validation, and analytics event hooks.
- `Files/form-handler.js` — optional server adapter stub; it must perform no external write until a later integration workflow configures it.
- `analytics.json` — intended first-party event contract; it must not transmit events in the preview.
- `Files/README.md` — setup, environment variables, test, publish, and rollback instructions.

This workflow is HTML-first. Do not generate PDF bytes, remote assets, Notion calls, Drive calls, or other integration payloads.

## Quality bar

Use semantic landmarks, a visible skip link, keyboard focus, reduced-motion handling, strong contrast, responsive layouts, explicit labels, consent copy, success/error states, and no fake proof. The live preview must remain useful without JavaScript.

Treat every quantitative performance, implementation-time, source-coverage, data-freshness, security, certification, customer, or compliance statement as unverified unless it appears verbatim in the approved brief. Do not infer or invent these claims. Describe principles and workflows qualitatively when proof is absent.

## Output contract

Return a delimiter-based file bundle with no prose and no Markdown code fences. This avoids forcing complete HTML, CSS, and JavaScript through one fragile escaped JSON string.

```text
===PROJECT===
name: Project name
entrypoint: index.html
===FILE index.html | text/html | entry===
<!doctype html>
<html>...</html>
===END FILE===
===FILE Assets/styles.css | text/css | style===
/* complete CSS */
===END FILE===
```

Repeat the file block for every required file. Write raw, complete file content between the markers. Never abbreviate content with ellipses. Every referenced local path must exist. The runtime validates this bundle and converts it into the typed project artifact. Never invent a configured integration.

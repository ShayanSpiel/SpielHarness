# Landing Page Project Contract

Landing projects are structured artifacts, not one giant Markdown response.

## Root

`index.html` is the entrypoint. It references project-relative assets only.

## Assets

`Assets/` contains browser-delivered CSS, JavaScript, SVG, images, and fonts. Prefer code-native SVG and CSS treatments over remote decorative media.

## Files

`Files/` contains the form handler, analytics contract, setup instructions, structured data, and separate documents such as PDF. Secrets are environment variables and never appear in `index.html` or `Assets/app.js`.

## Form communication

The browser form posts JSON to a server endpoint. The server endpoint validates and normalizes input, then writes to Notion using `NOTION_TOKEN` and `NOTION_DATABASE_ID`. The endpoint returns a typed success/error receipt; the client renders that state accessibly.

## Artifact UI

The bundle must be inspectable as a sandboxed HTML Preview, per-file Source, and Files tree. PDF files use real PDF bytes and `application/pdf`.

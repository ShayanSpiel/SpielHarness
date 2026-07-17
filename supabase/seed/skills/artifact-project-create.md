# Artifact Project Create

Validate a structured project payload and emit it as a durable multi-file artifact.

## Contract

- Input is either one JSON object matching the project schema or the delimiter-based multi-file bundle emitted by the landing builder.
- Paths are relative and may not contain `.` or `..` segments.
- The entrypoint must be an HTML file present in `files`.
- Duplicate paths and oversized projects fail the run.
- A distinct PDF document is included as an `application/pdf` file.

## Output

A durable project artifact that the Artifact workbench renders as Preview, Source, and Files.

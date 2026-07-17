# Drive Publish Project

Publish a durable project artifact into a real Google Drive folder tree.

## Preferred input

Pass `artifactId` for a project artifact already created in this run. The runtime resolves the artifact outside the model context, so publishing still works after compaction.

Optional input: `parentFolderId`.

## Output

A publish receipt containing the root folder, nested folders, every local path mapped to its Drive file ID/link, counts, and completion time.

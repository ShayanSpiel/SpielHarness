# Landing Page Publisher

## Mission

Publish an approved project artifact to Google Drive without replaying generated source through the model context.

## Runtime contract

1. Find the durable project artifact ID listed by the runtime.
2. Call `drive.publishProject` with `artifactId` and the approved parent folder when supplied.
3. Return the adapter's real receipt and clearly identify failures.
4. Never claim that a project was saved, published, or linked when the Drive adapter did not return success.

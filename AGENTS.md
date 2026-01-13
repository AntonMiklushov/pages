# Agent Instructions

## Secrets and local config
- Store secrets only in `.env.local` (gitignored). Do not print or commit values.
- Expected keys: `LIB_PASSWORD`, `LIB_BASE_URL`, optional `LIB_PBKDF2_ITERS`, and optional `AWS_PROFILE`.
- If `.env.local` exists, use it directly and do not ask the user to re-share secrets.

## Build and upload library
1. Load `.env.local` into the environment.
2. Run `npm run build:library` (updates `library/catalog.enc` and `out/objects`).
3. Upload encrypted objects with:
   `aws --endpoint-url=https://storage.yandexcloud.net s3 sync out/objects s3://<bucket>/`
4. Commit and push only safe files (for example `library/catalog.enc` and non-secret edits).

## Notes
- `LIB_BASE_URL` must end with `/`.
- Never echo or log secret values in commands or responses.

# Agent Instructions

## Project summary
- Static landing page plus a client-side encrypted PDF library for GitHub Pages.
- Plaintext PDFs live only in `library_src/pdfs/` (gitignored). Everything served is encrypted.
- The browser decrypts the catalog and PDFs locally after the user enters a passphrase.

## Repo layout
- `index.html`: landing page.
- `assets/`: landing page styles and images.
- `library/`: static library app (`index.html`, `styles.css`, `app.js`) and `catalog.enc`.
- `library_src/`: plaintext PDFs + optional `metadata.json` (gitignored).
- `tools/`: build scripts (`build-library.mjs`, `crypto.mjs`, `build-and-upload.ps1`).
- `out/`: build output (gitignored) with encrypted objects and build cache.

## Secrets and local config
- Store secrets only in `.env.local` (gitignored). Never print or commit values.
- Required keys: `LIB_PASSWORD`, `LIB_BASE_URL` (must end with `/`).
- Optional keys: `LIB_PBKDF2_ITERS` (default `300000`), `AWS_PROFILE`.
- If `.env.local` exists, use it directly and do not ask the user to re-share secrets.

## Build pipeline (technical)
- `tools/build-library.mjs`:
  - Reads PDFs from `library_src/pdfs/`.
  - Applies optional metadata from `library_src/metadata.json`.
  - Encrypts each PDF with AES-GCM using PBKDF2 (SHA-256).
  - Writes encrypted objects under `out/objects/`.
  - Generates `out/catalog.json` and encrypts it to `library/catalog.enc`.
- Object keys are hash-based for unreadable filenames:
  - `objectKey = pdf/<sha256-of-plaintext>.pdf.enc`
  - `metadata.objectKey` is ignored to enforce hashed names.

## Incremental uploads
- Encryption is randomized, so re-encrypting unchanged PDFs would normally change ciphertext.
- To avoid re-uploading unchanged files:
  - `out/build-cache.json` stores a local key fingerprint (hash of password + iterations).
  - If the cache matches, the build skips encryption when the target object file already exists.
  - Result: `aws s3 sync` uploads only new or changed objects.
- If the passphrase or iterations change, the cache invalidates and all PDFs are re-encrypted.
- To force a full rebuild manually, delete `out/objects/` and `out/build-cache.json`.

## Upload to Yandex Cloud
- Use AWS CLI with the Yandex endpoint:
  - `aws --endpoint-url=https://storage.yandexcloud.net s3 sync out/objects s3://<bucket>/`
- `tools/build-and-upload.ps1` automates: load `.env.local`, build, sync.

## Safe vs unsafe commits
- Safe to commit: `library/catalog.enc`, `library/` UI edits, landing page edits, scripts, `AGENTS.md`.
- Never commit: `.env.local`, `library_src/`, `out/` (already gitignored).

## Metadata format (`library_src/metadata.json`)
- Supports per-item overrides: `title`, `authors`, `tags`, `notes`, `year`, `size`.
- Items can be keyed by filename or id. `objectKey` is ignored.

## Troubleshooting
- Unlock fails after password change: rebuild (cache should force re-encryption) and re-upload.
- CORS issues: ensure the bucket CORS allows your GitHub Pages origin with GET/HEAD.
- If AWS CLI is not on PATH, use the default install path:
  - `C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe`

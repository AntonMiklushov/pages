# Agent Instructions

## Scope
- Maintain a static landing page plus a client-side encrypted PDF library.
- Plaintext PDFs live only in library_src/pdfs/ (gitignored). Everything served is encrypted.
- The browser decrypts the catalog and PDFs locally after the user enters a passphrase.

## Repo layout
- index.html: landing page.
- assets/: landing page styles, scripts, and images.
- library/: static library app (index.html, styles.css, app.js) and catalog.enc.
- library_src/: plaintext PDFs + optional metadata.json (gitignored).
- tools/: build scripts (build-library.mjs, crypto.mjs, build-and-upload.ps1, build-and-upload.sh).
- out/: build output (gitignored) with encrypted objects and build cache.

## Secrets and local config
- Store secrets only in .env.local (gitignored). Never print or commit values.
- Required keys: LIB_PASSWORD, LIB_BASE_URL (must end with /).
- Optional keys: LIB_PBKDF2_ITERS (default 300000), AWS_PROFILE.
- If .env.local exists, use it directly and do not ask the user to re-share secrets.

## Build and upload scripts
- Windows (PowerShell): tools/build-and-upload.ps1
- Linux/macOS (bash): tools/build-and-upload.sh
- Manual upload: aws --endpoint-url=https://storage.yandexcloud.net s3 sync out/objects s3://<bucket>/

## Build pipeline details
- tools/build-library.mjs:
  - Reads PDFs from library_src/pdfs/.
  - Applies optional metadata from library_src/metadata.json.
  - Encrypts each PDF with AES-GCM using PBKDF2 (SHA-256).
  - Writes encrypted objects under out/objects/.
  - Generates out/catalog.json and encrypts it to library/catalog.enc.
- Object keys are hash-based for unreadable filenames:
  - objectKey = pdf/<sha256-of-plaintext>.pdf.enc
  - metadata.objectKey is ignored to enforce hashed names.

## Incremental uploads
- Encryption is randomized, so re-encrypting unchanged PDFs would normally change ciphertext.
- To avoid re-uploading unchanged files:
  - out/build-cache.json stores a local key fingerprint (hash of password + iterations).
  - If the cache matches, the build skips encryption when the target object file already exists.
  - Result: aws s3 sync uploads only new or changed objects.
- If the passphrase or iterations change, the cache invalidates and all PDFs are re-encrypted.
- To force a full rebuild manually, delete out/objects/ and out/build-cache.json.

## Landing page frog images
- The slideshow uses .frog-stage and .frog-slide in index.html.
- Each slide expects assets/img/<base>.jpg, .webp, .avif, and <base>_blur.jpg.
- Keep frog images square (1:1, currently 1200x1200) so the layout stays stable.
- Avoid cropped edges: center the subject and use a blurred background fill if needed.
- Blur placeholders are 32x32 JPGs used as background-image on the slide container.

## Metadata format (library_src/metadata.json)
- Supports per-item overrides: title, authors, tags, notes, year, size.
- Items can be keyed by filename or id. objectKey is ignored.
- File must be UTF-8 without BOM.

## Safe vs unsafe commits
- Safe to commit: library/catalog.enc, library/ UI edits, landing page edits, scripts, AGENTS.md.
- Never commit: .env.local, library_src/, out/ (already gitignored).

## Troubleshooting
- Unlock fails after password change: rebuild (cache should force re-encryption) and re-upload.
- CORS issues: ensure the bucket CORS allows your GitHub Pages origin with GET/HEAD.
- If AWS CLI is not on PATH (Windows), use C:\Program Files\Amazon\AWSCLIV2\aws.exe.

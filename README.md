# Encrypted PDF Library (GitHub Pages)

## Overview
This site serves a static homepage plus a client-side encrypted PDF library. The
repo only stores an encrypted catalog (library/catalog.enc). The PDFs are
encrypted and uploaded to Yandex Cloud Object Storage. Decryption happens
entirely in the browser after the user enters a passphrase.

## Requirements
- Node.js 18+
- AWS CLI v2
- Bash (Linux/macOS) or PowerShell (Windows)
- Yandex Cloud Object Storage bucket
- GitHub Pages enabled for this repository

## Environment file (.env.local)
Create .env.local in the repo root (gitignored). Do not commit it.

Required keys:
- LIB_PASSWORD
- LIB_BASE_URL (must end with / and include the bucket path)

Optional keys:
- LIB_PBKDF2_ITERS (default 300000)
- AWS_PROFILE

## Yandex Cloud setup
1. Create an Object Storage bucket.
2. Enable public read access for objects (safe because the files are ciphertext).
3. Configure CORS to allow your GitHub Pages origin.
   Example baseUrl format: https://storage.yandexcloud.net/<bucket>/

Example CORS configuration (adjust the origin):
```json
[
  {
    "allowedOrigins": ["https://<user>.github.io"],
    "allowedMethods": ["GET", "HEAD"],
    "allowedHeaders": ["*"],
    "maxAgeSeconds": 3600
  }
]
```

## Build and upload (Windows)
```
powershell -ExecutionPolicy Bypass -File tools/build-and-upload.ps1
```

## Build and upload (Linux/macOS)
```
chmod +x tools/build-and-upload.sh
./tools/build-and-upload.sh
```

## Adding PDFs and metadata
1. Put plaintext PDFs into library_src/pdfs/ (do not commit this folder).
2. Optional: add library_src/metadata.json to override title, authors, tags,
   notes, year, or size. Entries can be keyed by filename or id. objectKey is
   ignored to enforce hashed names.
3. Build and upload.
4. Commit library/catalog.enc and push to deploy via GitHub Pages.

Note: metadata.json must be UTF-8 without BOM.

## Incremental uploads
Encryption is randomized, so re-encrypting unchanged PDFs would normally change
ciphertext. To avoid re-uploading unchanged files:
- out/build-cache.json stores a local key fingerprint (hash of password + iters).
- If the cache matches, the build skips encryption when the target object exists.

To force a full rebuild, delete out/objects/ and out/build-cache.json.

## Uploading encrypted objects manually
Use AWS CLI with the Yandex endpoint:
```
aws --endpoint-url=https://storage.yandexcloud.net s3 sync out/objects s3://<bucket>/
```
Credentials are only required for uploads. The website itself uses no
credentials.

## Security notes
- Without the passphrase, the catalog and PDFs remain unreadable ciphertext.
- Anyone with the passphrase can decrypt and save the PDFs.
- Use a long, unique passphrase.

## Troubleshooting
- CORS errors: confirm the bucket CORS allows your Pages origin and GET/HEAD.
- PDF not rendering inline on iOS: use "Open in new tab".
- Wrong password or corrupted file: re-run the build with the correct passphrase
  and confirm library/catalog.enc was updated.
- If the library never unlocks, make sure you ran the build at least once to
  generate a fresh library/catalog.enc.

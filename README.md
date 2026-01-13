# Encrypted PDF Library (GitHub Pages)

## Overview
This site serves a static homepage plus a client-side encrypted PDF library. The
repo only stores an encrypted catalog (`library/catalog.enc`). The PDFs are
encrypted and uploaded to Yandex Cloud Object Storage. Decryption happens
entirely in the browser after the user enters a passphrase.

## Requirements
- Node.js 18+
- Yandex Cloud Object Storage bucket
- GitHub Pages enabled for this repository

## Yandex Cloud setup
1. Create an Object Storage bucket.
2. Enable public read access for objects (safe because the files are ciphertext).
3. Configure CORS to allow your GitHub Pages origin.
   Example baseUrl format: `https://storage.yandexcloud.net/<bucket>/`

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

## Uploading encrypted objects
Use AWS CLI with the Yandex endpoint:
```
aws --endpoint-url=https://storage.yandexcloud.net s3 sync out/objects s3://<bucket>/
```
Credentials are only required for uploads. The website itself uses no credentials.

## Adding PDFs
1. Put plaintext PDFs into `library_src/pdfs/` (do not commit this folder).
2. Optional: add `library_src/metadata.json` to override titles, authors, tags,
   notes, year, or objectKey. Entries can be matched by filename or by id.
3. Build encrypted outputs:
```
LIB_PASSWORD="your passphrase" \
LIB_BASE_URL="https://storage.yandexcloud.net/<bucket>/" \
npm run build:library
```
4. Upload `out/objects` to the bucket.
5. Commit `library/catalog.enc` and push to deploy via GitHub Pages.

Optional: set `LIB_PBKDF2_ITERS` to override the default PBKDF2 iterations
(default is 300000).

## Security notes
- Without the passphrase, the catalog and PDFs remain unreadable ciphertext.
- Anyone with the passphrase can decrypt and save the PDFs.
- Use a long, unique passphrase.

## Troubleshooting
- CORS errors: confirm the bucket CORS allows your Pages origin and GET/HEAD.
- PDF not rendering inline on iOS: use "Open in new tab".
- Wrong password/corrupted file: re-run the build with the correct passphrase
  and confirm `library/catalog.enc` was updated.
- If the library never unlocks, make sure you ran the build at least once to
  generate a fresh `library/catalog.enc`.

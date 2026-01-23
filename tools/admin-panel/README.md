# Local Library Admin Panel

This is a local-only admin UI for the encrypted PDF/DJVU library. It runs on your machine and
uses AWS CLI to upload/delete objects in S3-compatible storage.

## Run

Windows:

  tools\admin-panel\start.ps1

Linux/macOS:

  ./tools/admin-panel/start.sh

Then open:

  http://127.0.0.1:8787

You can change the port with `ADMIN_PANEL_PORT`.

## Notes

- The panel reads and writes the catalog file you specify (default: `library/catalog.enc`).
- You must enter the catalog password to load a library.
- New uploads are encrypted with that password and the PBKDF2 iterations you provide.
- Deleting items removes them from S3 and updates the catalog on disk.
- AWS credentials are taken from your existing AWS CLI configuration.
- If you use a custom S3 endpoint (e.g., Yandex Cloud), set it in the UI.

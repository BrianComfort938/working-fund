# Petty Cash Fund

A small system for recording petty-cash transactions in the field (mobile) and
reviewing / printing / archiving them locally.

## Architecture (free tier, no credit card)

```
[Phone] --> GitHub Pages (static frontend, /docs)
               --> Vercel serverless function (/api, holds the DB secret)
                      --> MongoDB Atlas (cloud queue of unlogged transactions)
                                                       |
                                            (Local Python script, on demand)
                                                       v
[Printer] <-- Local React review app <-- Local MySQL + transaction-backup.csv
```

> **Note (2026):** MongoDB's Atlas **Data API / HTTPS Endpoints / App Services
> reached end-of-life on 30 Sep 2025.** The phone can no longer talk to Atlas
> directly through MongoDB. The secure layer must be a small serverless function
> you control (Vercel here), which keeps the database password as a private
> environment variable — never in the public frontend code.

## Repository layout

| Path        | What it is                                            | Status |
|-------------|-------------------------------------------------------|--------|
| `docs/`     | Mobile web portal (static — served by GitHub Pages)   | ✅ built |
| `api/`      | Vercel serverless functions (the secure API layer)    | ✅ built |
| `local/`    | Python fetch → browser review → print → SQLite + CSV   | ✅ built |

Deployment steps for `docs/` + `api/` are in [SETUP.md](SETUP.md).

## `docs/` — the mobile portal (done)

Fields: beneficiary (*demandeur*), account (the 30 exact codes, grouped & color
coded), description (*but*), amount (whole-number XOF with a **+/− toggle** for
negatives), method (Cash / Wave / Orange), receipt photo + an extra Wave
screenshot when paying by Wave. Photos are compressed in the browser before
upload to keep the 512 MB free tier nearly empty. A **Wave balance** card sits at
the top; Wave payments subtract from it automatically.

**Offline-first:** if no backend is set (or the network is down), submissions are
queued on the phone and synced later with one tap — useful for field work with
spotty internet.

### Preview locally (desktop)

```powershell
cd docs
python -m http.server 8080
# open http://localhost:8080
```

Camera capture works over `localhost` and over HTTPS (GitHub Pages is HTTPS).

### Configure the backend

Either edit `docs/config.js` (`API_BASE_URL`) or use the in-app ⚙️ menu and paste
your deployed API URL. Empty = offline mode.

## Local review app (`local/`)

```powershell
cd local
pip install -r requirements.txt
# optional: copy .env.example to .env and add your Atlas URI (otherwise DEMO mode)
python app.py
```

A browser tab opens at `http://127.0.0.1:5000`. Set the **fund period** (000–999),
then for each transaction: **A** = approve + print the A4 record, **E** = edit,
**D** = delete, **←/→** = move, **[ ]** = change calendar month. Approved rows are
written to `local/pettycash.db` (SQLite — MySQL later) and
`local/transaction-backup.csv`; once the CSV passes 100 rows the oldest 100 are
auto-printed on one sheet and rolled into `local/printed-batches/`. Receipt photos
are saved to `local/receipts/`.

## Next steps

1. Deploy `docs/` + `api/` following [SETUP.md](SETUP.md) (Atlas → Vercel → Pages).
2. Try the local app above (runs in DEMO mode with sample data until your Atlas
   URI is set), then switch SQLite → MySQL when ready.

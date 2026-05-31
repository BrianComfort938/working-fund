# Working Fund

A small system for recording working-fund transactions in the field (mobile) and
reviewing / printing / archiving them locally. Supports two missions — **East**
and **South** — kept as separate funds throughout.

- **Repo:** https://github.com/BrianComfort938/working-fund
- **Mobile portal** (live once Pages finishes building): https://briancomfort938.github.io/working-fund/

## Architecture (free tier, no credit card)

```
[Phone] --> GitHub Pages (static frontend, /docs)
               --> Vercel serverless function (/api, holds the DB secret)
                      --> MongoDB Atlas (cloud queue of unlogged transactions)
                                                       |
                                            (Local Python script, on demand)
                                                       v
[Printer] <-- Local browser review app <-- Local SQLite + transaction-backup.csv
```

> **Note (2026):** MongoDB's Atlas **Data API / HTTPS Endpoints / App Services
> reached end-of-life on 30 Sep 2025.** The phone can no longer talk to Atlas
> directly through MongoDB. The secure layer must be a small serverless function
> you control (Vercel here), which keeps the database password as a private
> environment variable — never in the public frontend code.

## Missions (East / South)

Every transaction carries a `mission` of `east` or `south`. On the **portal**, a
mission selector at the top decides where a transaction is filed; the choice is
remembered per device in `localStorage` (default **East**). Wave balance and the
offline outbox are tracked **per mission**. On the **local review app**, you pick a
mission and only that mission's transactions are shown, printed, and saved.

## Repository layout

| Path        | What it is                                            | Status |
|-------------|-------------------------------------------------------|--------|
| `docs/`     | Mobile web portal (static — served by GitHub Pages)   | ✅ built |
| `api/`      | Vercel serverless functions (the secure API layer)    | ✅ built |
| `local/`    | Python fetch → browser review → print → SQLite + CSV   | ✅ built |

Deployment steps for `docs/` + `api/` are in [SETUP.md](SETUP.md).

## `docs/` — the mobile portal

Fields: **mission** (East / South), beneficiary (*demandeur*), account (the 30
exact codes, grouped & color coded), description (*but*), amount (whole-number XOF
with a **+/− toggle** for negatives), method (Cash / Wave / Orange), receipt photo
+ an extra Wave screenshot when paying by Wave. Photos are compressed in the
browser before upload to keep the 512 MB free tier nearly empty. A per-mission
**Wave balance** card sits near the top; Wave payments subtract from it
automatically.

**Offline-first:** if no backend is set (or the network is down), submissions are
queued on the phone (per mission) and synced later with one tap — useful for field
work with spotty internet.

### Preview locally (desktop)

```powershell
cd docs
python -m http.server 8080
# open http://localhost:8080
```

Camera capture works over `localhost` and over HTTPS (GitHub Pages is HTTPS).

### Configure the backend

Either edit `docs/config.js` (`API_BASE_URL`) or use the in-app ⚙️ menu and paste
your deployed API URL. Empty = offline mode. `DEFAULT_MISSION` in `config.js` sets
the first-run mission (overridden once the user picks one on the device).

## Local review app (`local/`)

```powershell
cd local
pip install -r requirements.txt
# optional: copy .env.example to .env and add your Atlas URI (otherwise DEMO mode)
python app.py
```

A browser tab opens at `http://127.0.0.1:5000`. Pick the **mission** (East / South
— remembered per browser), set the **fund period** (000–999), then for each
transaction: **A** = approve + print the A4 record, **E** = edit (incl. moving it
to the other mission), **D** = delete, **M** = switch mission, **←/→** = move,
**[ ]** = change calendar month. Approved rows are written to
`local/workingfund.db` (SQLite — MySQL later) and `local/transaction-backup.csv`
(both include the mission); once the CSV passes 100 rows the oldest 100 are
auto-printed on one sheet and rolled into `local/printed-batches/`. Receipt photos
are saved to `local/receipts/`.

## Next steps

1. ✅ **Pushed to GitHub** — repo above, with Pages enabled from `/docs`
   (portal at https://briancomfort938.github.io/working-fund/, live ~1 min after
   each build).
2. Deploy `api/` and create the database following [SETUP.md](SETUP.md)
   (MongoDB Atlas → Vercel), then open the portal's ⚙️ menu and paste your Vercel
   API URL to connect the phone to the cloud.
3. Try the local app above (runs in DEMO mode with sample data until your Atlas
   URI is set), then switch SQLite → MySQL when ready.

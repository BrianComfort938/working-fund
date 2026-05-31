# Setup & Deployment

Three free services, no credit card needed:
**MongoDB Atlas** (database) · **Vercel** (the secure API) · **GitHub Pages** (the phone frontend).

---

## 1. MongoDB Atlas (database)

1. Create a free account → create a free **M0** cluster.
2. **Database Access** → add a database user (username + a strong password). Save them.
3. **Network Access** → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`).
   (Vercel's outbound IPs change, so the password is what protects you.)
4. **Connect → Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Replace `PASSWORD` with the real one.

> The database (`workingfund`) and collections (`transactions`, `system_settings`)
> are created automatically on the first write — nothing to set up by hand.
> Each transaction carries a `mission` field (`east` or `south`); the Wave balance
> is stored per mission.

---

## 2. Push this project to GitHub  ✅ done

Already on GitHub: **https://github.com/BrianComfort938/working-fund** (public,
branch `main`). Future changes just need `git push`.

---

## 3. Vercel (the secure API)

1. Free account → **Add New… → Project** → import your GitHub repo.
2. Leave build settings as detected (zero-config: it finds `/api` and installs `mongodb`).
3. **Settings → Environment Variables**, add:

   | Name             | Value                                                | Required |
   |------------------|------------------------------------------------------|----------|
   | `MONGODB_URI`    | your Atlas connection string (the secret)            | yes      |
   | `MONGODB_DB`     | `workingfund`                                         | optional |
   | `ALLOWED_ORIGIN` | your Pages URL, e.g. `https://USERNAME.github.io`    | optional |

4. **Deploy.** Your API base becomes `https://YOUR-PROJECT.vercel.app/api`.
5. Quick test: open `https://YOUR-PROJECT.vercel.app/api/balance` in a browser →
   it should return `{"wave":null}`. That means the DB connection works.

---

## 4. GitHub Pages (the phone frontend)

1. Repo → **Settings → Pages** → Build and deployment → **Deploy from a branch**.
2. Branch `main`, folder **`/docs`** → Save.
3. Your portal goes live at `https://USERNAME.github.io/REPO/`.

---

## 5. Connect the phone to the cloud

Open the portal on your phone → tap **⚙️** → paste `https://YOUR-PROJECT.vercel.app/api` → Save.
The header should change from "Offline mode" to **"Cloud connected"**.

---

## Security model (honest version)

- ✅ Your **database password lives only in Vercel's environment variables** — never
  in the public GitHub Pages code. This is the important one, and it's handled.
- ⚠️ The API endpoints themselves are currently **open** (anyone who discovers the
  URL could read/add records). For a personal working fund behind an obscure
  HTTPS URL this is usually acceptable.
- 🔒 When you want to lock writes behind a password, say so — I'll add a `WRITE_KEY`
  check to the API and a matching key field in the portal's ⚙️ settings.

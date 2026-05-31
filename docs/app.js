(function () {
  "use strict";

  // ---- Exact account codes (KEEP EXACT — do not edit) ----
  const ACCOUNT_CODES = {
    "00": "400-5102 Travel In-field",
    "01": "400-5700 Furnishings YM",
    "02": "400-5930 Food and Personal Items",
    "03": "400-5868 Utilities YM",
    "04": "400-5862 Rent YM",
    "05": "400-5920 Charitable Assistance",
    "06": "400-5221 Book of Mormon",
    "10": "000-5102 Travel Admin",
    "11": "000-5496 Luncheons, Socials & Hosting",
    "12": "000-5860 Small Purchases/Services for Mission Home & Office",
    "13": "000-5500 Miscellaneous",
    "14": "000-5370 Telephone and Internet",
    "15": "000-5221 Teaching Literature and Supplies",
    "16": "000-5200 Operating materials and supplies",
    "17": "000-5170 Vehicle Gasoline",
    "18": "000-5379 Postage and Mailing",
    "19": "000-5700 Small Office Equipment",
    "20": "000-5461 Bank Fees",
    "21": "000-5776 Small Office Equipment and Maintenance",
    "22": "000-5862 Rent Admin",
    "23": "000-5868 Utilities Admin",
    "30": "480-5862 Rent SM",
    "31": "480-5700 Furnishings SM",
    "32": "480-5868 Utilities SM",
    "40": "600-5480 Vehicle Taxes and Fees",
    "41": "600-5700 Vehicle Equipment",
    "42": "600-5772 Vehicle Maintenance and repairs",
    "50": "900-5102 Travel, Baggage, Visa and Other",
    "51": "900-5949 Missionary Medical"
  };

  // Color + grouping by the leading 3-digit series (used here and in the review app).
  const SERIES_META = {
    "400": { label: "YM / Field", color: "#22c55e" },
    "000": { label: "Admin",      color: "#3b82f6" },
    "480": { label: "SM",         color: "#a855f7" },
    "600": { label: "Vehicle",    color: "#f59e0b" },
    "900": { label: "Travel & Medical", color: "#ef4444" }
  };
  const seriesKey   = (name) => (name || "").slice(0, 3);
  const seriesColor = (name) => (SERIES_META[seriesKey(name)] || {}).color || "#94a3b8";

  const cfg = window.PETTYCASH_CONFIG || {};
  const CURRENCY = cfg.CURRENCY || "XOF";

  // ---- helpers ----
  const $ = (id) => document.getElementById(id);
  const groupDigits = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const apiBase = () =>
    (localStorage.getItem("pettycash_api_base") || cfg.API_BASE_URL || "").replace(/\/$/, "");

  // ---- state ----
  let amountSign = 1;          // +1 or -1
  let amountDigits = "";       // raw digits, no separators
  let method = "";             // "cash" | "wave" | "orange"
  let receiptImage = "";       // compressed dataURL
  let waveReceiptImage = "";

  // =========================================================================
  // Account dropdown (grouped + color chip)
  // =========================================================================
  function buildAccountSelect() {
    const select = $("account");
    const order = [];                 // preserve first-seen series order
    const groups = {};
    Object.entries(ACCOUNT_CODES).forEach(([code, name]) => {
      const k = seriesKey(name);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push({ code, name });
    });
    order.forEach((k) => {
      const meta = SERIES_META[k] || { label: k };
      const og = document.createElement("optgroup");
      og.label = `${k} · ${meta.label}`;
      groups[k].forEach(({ code, name }) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${code} — ${name}`;
        og.appendChild(opt);
      });
      select.appendChild(og);
    });

    select.addEventListener("change", () => {
      const name = ACCOUNT_CODES[select.value];
      const chip = $("accountChip");
      if (!name) { chip.classList.add("hidden"); return; }
      const color = seriesColor(name);
      chip.style.borderLeftColor = color;
      chip.innerHTML = `<span class="swatch" style="background:${color}"></span><span>${name}</span>`;
      chip.classList.remove("hidden");
    });
  }

  // =========================================================================
  // Amount (integer XOF + sign toggle)
  // =========================================================================
  function renderAmount() {
    const preview = $("amountPreview");
    const n = amountDigits ? parseInt(amountDigits, 10) : 0;
    const signStr = amountSign < 0 ? "-" : "";
    preview.textContent = `${signStr}${groupDigits(n)} ${CURRENCY}`;
    preview.classList.toggle("neg", amountSign < 0 && n !== 0);
    const btn = $("signBtn");
    btn.textContent = amountSign < 0 ? "−" : "+";
    btn.classList.toggle("neg", amountSign < 0);
  }
  function wireAmount() {
    const input = $("amount");
    input.addEventListener("input", () => {
      amountDigits = input.value.replace(/\D/g, "");
      input.value = amountDigits ? groupDigits(amountDigits) : "";
      renderAmount();
    });
    $("signBtn").addEventListener("click", () => {
      amountSign = -amountSign;
      renderAmount();
    });
  }
  const amountValue = () => (amountDigits ? amountSign * parseInt(amountDigits, 10) : 0);

  // =========================================================================
  // Method selection
  // =========================================================================
  function wireMethods() {
    document.querySelectorAll(".method-btn").forEach((b) => {
      b.addEventListener("click", () => {
        method = b.dataset.method;
        document.querySelectorAll(".method-btn").forEach((x) =>
          x.setAttribute("aria-pressed", String(x === b)));
        const isWave = method === "wave";
        $("waveReceiptField").classList.toggle("hidden", !isWave);
        $("waveNote").classList.toggle("hidden", !isWave);
      });
    });
  }

  // =========================================================================
  // Photos (compress client-side to keep cloud storage tiny)
  // =========================================================================
  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let { width, height } = img;
          if (width >= height && width > maxDim) {
            height = Math.round((height * maxDim) / width); width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height); height = maxDim;
          }
          const c = document.createElement("canvas");
          c.width = width; c.height = height;
          c.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(c.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function kbOf(dataUrl) {
    // rough size of a base64 dataURL in KB
    return Math.round((dataUrl.length * 0.75) / 1024);
  }

  function wirePhoto(inputs, previewId, setter) {
    const preview = $(previewId);
    function show(dataUrl) {
      setter(dataUrl);
      preview.innerHTML =
        `<img src="${dataUrl}" alt="receipt">` +
        `<div class="meta"><span>${kbOf(dataUrl)} KB</span>` +
        `<button type="button" class="remove">Remove</button></div>`;
      preview.classList.remove("hidden");
      preview.querySelector(".remove").addEventListener("click", () => {
        setter(""); preview.innerHTML = ""; preview.classList.add("hidden");
      });
    }
    inputs.forEach((inp) =>
      inp.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          show(await compressImage(file, 1280, 0.6));
        } catch (_) {
          toast("Could not read that image", "err");
        }
        e.target.value = ""; // allow re-selecting the same file
      }));
  }

  // =========================================================================
  // Wave balance
  // =========================================================================
  async function loadWaveBalance() {
    const base = apiBase();
    let val = null;
    if (base) {
      try {
        const r = await fetch(base + "/balance");
        if (r.ok) { const j = await r.json(); val = j.wave; }
      } catch (_) { /* fall through to local */ }
    }
    if (val == null) {
      const local = localStorage.getItem("pettycash_wave_balance");
      val = local == null ? null : parseInt(local, 10);
    }
    renderWaveBalance(val);
  }
  function renderWaveBalance(val) {
    $("waveBalance").textContent = (val == null || isNaN(val))
      ? `— ${CURRENCY}` : `${groupDigits(val)} ${CURRENCY}`;
  }
  function currentWave() {
    const t = $("waveBalance").textContent.replace(/[^\d-]/g, "");
    return t ? parseInt(t, 10) : 0;
  }
  async function saveWaveBalance(val) {
    localStorage.setItem("pettycash_wave_balance", String(val));
    renderWaveBalance(val);
    const base = apiBase();
    if (base) {
      try {
        await fetch(base + "/balance", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wave: val })
        });
      } catch (_) { /* stays local until next sync */ }
    }
  }
  function wireWave() {
    $("editWaveBtn").addEventListener("click", () => {
      $("waveInput").value = String(currentWave() || "");
      $("waveEditRow").classList.remove("hidden");
      $("waveInput").focus();
    });
    $("cancelWaveBtn").addEventListener("click", () =>
      $("waveEditRow").classList.add("hidden"));
    $("saveWaveBtn").addEventListener("click", () => {
      const v = parseInt($("waveInput").value.replace(/\D/g, ""), 10);
      if (!isNaN(v)) saveWaveBalance(v);
      $("waveEditRow").classList.add("hidden");
    });
  }

  // =========================================================================
  // Submit + offline outbox
  // =========================================================================
  function loadOutbox() {
    try { return JSON.parse(localStorage.getItem("pettycash_outbox") || "[]"); }
    catch (_) { return []; }
  }
  function saveOutbox(arr) {
    localStorage.setItem("pettycash_outbox", JSON.stringify(arr));
    renderOutbox();
  }
  function renderOutbox() {
    const n = loadOutbox().length;
    const box = $("outbox");
    if (n === 0) { box.classList.add("hidden"); return; }
    $("outboxText").textContent =
      `${n} transaction${n > 1 ? "s" : ""} waiting to sync`;
    box.classList.remove("hidden");
  }

  async function postTransaction(tx) {
    const base = apiBase();
    if (!base) throw new Error("offline");
    const r = await fetch(base + "/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tx)
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json().catch(() => ({}));
  }

  async function syncOutbox(silent) {
    const items = loadOutbox();
    if (!items.length) { if (!silent) toast("Nothing to sync"); return; }
    if (!apiBase()) { if (!silent) toast("Set a backend URL first", "err"); return; }
    const remaining = [];
    for (const tx of items) {
      try { await postTransaction(tx); }
      catch (_) { remaining.push(tx); }
    }
    saveOutbox(remaining);
    if (remaining.length === 0) toast(`Synced ${items.length}`, "ok");
    else toast(`Synced ${items.length - remaining.length}, ${remaining.length} left`, "err");
  }

  function validate() {
    if (!$("beneficiary").value.trim()) return "Enter a beneficiary";
    if (!$("account").value) return "Choose an account";
    if (amountValue() === 0) return "Enter an amount";
    if (!method) return "Choose a method";
    return null;
  }

  function resetForm() {
    $("txForm").reset();
    $("accountChip").classList.add("hidden");
    amountSign = 1; amountDigits = ""; method = ""; receiptImage = ""; waveReceiptImage = "";
    renderAmount();
    document.querySelectorAll(".method-btn").forEach((x) => x.setAttribute("aria-pressed", "false"));
    ["receiptPreview", "wavePreview"].forEach((id) => {
      $(id).innerHTML = ""; $(id).classList.add("hidden");
    });
    $("waveReceiptField").classList.add("hidden");
    $("waveNote").classList.add("hidden");
  }

  function wireSubmit() {
    $("txForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = validate();
      if (err) { toast(err, "err"); return; }

      const accountCode = $("account").value;
      const tx = {
        beneficiary: $("beneficiary").value.trim(),
        accountCode,
        accountName: ACCOUNT_CODES[accountCode],
        description: $("description").value.trim(),
        amount: amountValue(),
        currency: CURRENCY,
        method,
        receiptImage,
        waveReceiptImage: method === "wave" ? waveReceiptImage : "",
        clientCreatedAt: new Date().toISOString(),
        logged: false
      };

      const btn = $("submitBtn");
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        await postTransaction(tx);
        toast("Saved to cloud", "ok");
      } catch (_) {
        const ob = loadOutbox(); ob.push(tx); saveOutbox(ob);
        toast("Saved offline — will sync later", "ok");
      }

      // Wave balance decrements by the amount spent (optimistic).
      if (method === "wave") {
        await saveWaveBalance(currentWave() - tx.amount);
      }
      resetForm();
      btn.disabled = false; btn.textContent = "Save transaction";
    });
    $("syncBtn").addEventListener("click", () => syncOutbox(false));
  }

  // =========================================================================
  // Settings + connection state
  // =========================================================================
  function wireSettings() {
    const modal = $("settingsModal");
    $("settingsBtn").addEventListener("click", () => {
      $("apiUrlInput").value = localStorage.getItem("pettycash_api_base") || cfg.API_BASE_URL || "";
      modal.classList.remove("hidden");
    });
    $("closeSettings").addEventListener("click", () => modal.classList.add("hidden"));
    $("saveSettings").addEventListener("click", () => {
      const v = $("apiUrlInput").value.trim();
      if (v) localStorage.setItem("pettycash_api_base", v);
      else localStorage.removeItem("pettycash_api_base");
      modal.classList.add("hidden");
      refreshConnState();
      loadWaveBalance();
      toast("Settings saved", "ok");
    });
  }
  function refreshConnState() {
    const el = $("connState");
    if (apiBase()) { el.textContent = "Cloud connected"; el.className = "conn-state online"; }
    else { el.textContent = "Offline mode"; el.className = "conn-state offline"; }
  }

  // ---- toast ----
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (kind ? " " + kind : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // ---- init ----
  document.addEventListener("DOMContentLoaded", () => {
    buildAccountSelect();
    wireAmount();
    wireMethods();
    wirePhoto([$("receiptCam"), $("receiptGal")], "receiptPreview", (v) => { receiptImage = v; });
    wirePhoto([$("waveCam"), $("waveGal")], "wavePreview", (v) => { waveReceiptImage = v; });
    wireWave();
    wireSubmit();
    wireSettings();
    renderAmount();
    refreshConnState();
    renderOutbox();
    loadWaveBalance();
    if (apiBase()) syncOutbox(true); // quietly flush queue on load when online
  });
})();

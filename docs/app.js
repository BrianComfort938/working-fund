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

  // Account series coding (functional color, kept subdued for a professional look).
  const SERIES_META = {
    "400": { label: "Field", color: "#2e7d32" },
    "000": { label: "Admin", color: "#00618a" },
    "480": { label: "Senior", color: "#6a3d9a" },
    "600": { label: "Vehicle", color: "#e3811d" },
    "900": { label: "Travel / Medical", color: "#b3261e" }
  };
  const seriesKey = (name) => (name || "").slice(0, 3);
  const seriesColor = (name) => (SERIES_META[seriesKey(name)] || {}).color || "#69757f";

  const cfg = window.WORKINGFUND_CONFIG || {};
  const CURRENCY = cfg.CURRENCY || "XOF";
  const MISSIONS = ["east", "south"];
  const titleCase = (m) => (m === "south" ? "South" : "East");

  // Methods that carry a second (provider) receipt, plus that receipt's label.
  const SECOND_RECEIPT = { wave: "Wave receipt", orange: "Orange Money receipt" };

  // ---- helpers ----
  const $ = (id) => document.getElementById(id);
  const groupDigits = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const apiBase = () =>
    (localStorage.getItem("workingfund_api_base") || cfg.API_BASE_URL || "").replace(/\/$/, "");

  // ---- state ----
  let amountSign = 1;
  let amountDigits = "";
  let method = "";
  let receiptImage = "";       // compressed dataURL (main receipt)
  let secondImage = "";        // compressed dataURL (Wave / Orange receipt)
  let signature = null;        // compact vector strokes, see captureSignature()
  let mission = "";

  const balanceKey = (m) => "workingfund_wave_balance_" + (m || mission);
  const outboxKey  = (m) => "workingfund_outbox_" + (m || mission);

  // =========================================================================
  // Mission selection (remembered per device)
  // =========================================================================
  function currentMission() {
    const saved = localStorage.getItem("workingfund_mission");
    if (MISSIONS.indexOf(saved) !== -1) return saved;
    return MISSIONS.indexOf(cfg.DEFAULT_MISSION) !== -1 ? cfg.DEFAULT_MISSION : "east";
  }
  function wireMission() {
    document.querySelectorAll("#missionRow .seg").forEach((b) => {
      b.addEventListener("click", () => setMission(b.dataset.mission));
    });
  }
  function setMission(m) {
    if (MISSIONS.indexOf(m) === -1) m = "east";
    mission = m;
    localStorage.setItem("workingfund_mission", m);
    document.querySelectorAll("#missionRow .seg").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.mission === m)));
    $("waveMissionTag").textContent = "(" + titleCase(m) + ")";
    loadWaveBalance();
    renderOutbox();
  }

  // =========================================================================
  // Account dropdown (grouped + color chip)
  // =========================================================================
  function buildAccountSelect() {
    const select = $("account");
    const order = [];
    const groups = {};
    Object.entries(ACCOUNT_CODES).forEach(([code, name]) => {
      const k = seriesKey(name);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push({ code, name });
    });
    order.forEach((k) => {
      const meta = SERIES_META[k] || { label: k };
      const og = document.createElement("optgroup");
      og.label = `${k} — ${meta.label}`;
      groups[k].forEach(({ code, name }) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${code}  ${name}`;
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
      chip.innerHTML =
        `<span class="swatch" style="background:${color}"></span>` +
        `<span class="code">${select.value}</span><span>${name}</span>`;
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
    $("signBtn").addEventListener("click", () => { amountSign = -amountSign; renderAmount(); });
  }
  const amountValue = () => (amountDigits ? amountSign * parseInt(amountDigits, 10) : 0);

  // =========================================================================
  // Method selection
  // =========================================================================
  function wireMethods() {
    document.querySelectorAll("#methodRow .seg").forEach((b) => {
      b.addEventListener("click", () => {
        method = b.dataset.method;
        document.querySelectorAll("#methodRow .seg").forEach((x) =>
          x.setAttribute("aria-pressed", String(x === b)));
        const label = SECOND_RECEIPT[method];
        $("secondReceiptField").classList.toggle("hidden", !label);
        if (label) $("secondReceiptLabel").textContent = label;
        $("methodNote").classList.toggle("hidden", method !== "wave");
      });
    });
  }

  // =========================================================================
  // Photos — compressed client-side, kept small for an economical payload
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
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height); // flatten alpha -> smaller JPEG
          ctx.drawImage(img, 0, 0, width, height);
          resolve(c.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  const kbOf = (dataUrl) => Math.round((dataUrl.length * 0.75) / 1024);

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
        try { show(await compressImage(file, 1100, 0.55)); }
        catch (_) { toast("Could not read that image", "err"); }
        e.target.value = "";
      }));
  }

  // =========================================================================
  // Signature pad — stored as integer vector strokes (very economical:
  // a few hundred bytes vs a multi-KB image, and prints crisply).
  // Shape: { w, h, s: [[x,y,x,y,...], ...] } in CSS-pixel logical coords.
  // =========================================================================
  function drawSignature(canvas, sig, pad) {
    const ctx = canvas.getContext("2d");
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (!sig || !sig.s || !sig.s.length) return;
    pad = pad || 0;
    const scale = Math.min((cw - 2 * pad) / sig.w, (ch - 2 * pad) / sig.h);
    const ox = (cw - sig.w * scale) / 2, oy = (ch - sig.h * scale) / 2;
    ctx.lineWidth = Math.max(1.4, 2 * scale);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a2228";
    sig.s.forEach((flat) => {
      ctx.beginPath();
      for (let i = 0; i < flat.length; i += 2) {
        const x = ox + flat[i] * scale, y = oy + flat[i + 1] * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  function renderSignaturePreview() {
    const wrap = $("sigPreview");
    if (!signature) {
      wrap.classList.add("empty");
      wrap.innerHTML = `<span class="sig-empty-text">No signature collected</span>`;
      $("removeSigBtn").classList.add("hidden");
      $("collectSigBtn").textContent = "Collect signature";
      return;
    }
    wrap.classList.remove("empty");
    const c = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth || 320, h = 80;
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = w + "px"; c.style.height = h + "px";
    c.getContext("2d").scale(dpr, dpr);
    // draw at logical size then it scales via CSS-set width/height
    const lc = document.createElement("canvas"); lc.width = w; lc.height = h;
    drawSignature(lc, signature, 6);
    c.getContext("2d").drawImage(lc, 0, 0, w, h);
    wrap.innerHTML = "";
    wrap.appendChild(c);
    $("removeSigBtn").classList.remove("hidden");
    $("collectSigBtn").textContent = "Re-collect";
  }

  function wireSignature() {
    const modal = $("sigModal");
    const canvas = $("sigCanvas");
    const ctx = canvas.getContext("2d");
    let strokes = [];      // [[x,y,...], ...] integer logical coords
    let current = null;
    let drawing = false;
    let dpr = 1, lastSampleX = 0, lastSampleY = 0;

    function sizeCanvas() {
      const wrap = $("sigCanvasWrap");
      dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a2228";
      redraw(w, h);
      canvas._w = w; canvas._h = h;
    }
    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      strokes.forEach((flat) => {
        ctx.beginPath();
        for (let i = 0; i < flat.length; i += 2) {
          if (i === 0) ctx.moveTo(flat[i], flat[i + 1]); else ctx.lineTo(flat[i], flat[i + 1]);
        }
        ctx.stroke();
      });
    }
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
    }
    function down(e) {
      e.preventDefault(); drawing = true; current = [];
      const p = pos(e); lastSampleX = p.x; lastSampleY = p.y;
      current.push(p.x, p.y);
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      // sample only when moved enough -> fewer points -> smaller payload
      if (Math.abs(p.x - lastSampleX) + Math.abs(p.y - lastSampleY) < 2) return;
      lastSampleX = p.x; lastSampleY = p.y;
      current.push(p.x, p.y);
      ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    function up() {
      if (!drawing) return; drawing = false;
      if (current && current.length >= 2) strokes.push(current);
      current = null;
    }

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);

    function open() {
      strokes = signature ? signature.s.map((a) => a.slice()) : [];
      modal.classList.remove("hidden");
      requestAnimationFrame(sizeCanvas);
    }
    function close() { modal.classList.add("hidden"); }

    $("collectSigBtn").addEventListener("click", open);
    $("removeSigBtn").addEventListener("click", () => { signature = null; renderSignaturePreview(); });
    $("sigClear").addEventListener("click", () => { strokes = []; redraw(); });
    $("sigCancel").addEventListener("click", close);
    $("sigSave").addEventListener("click", () => {
      const nonEmpty = strokes.filter((s) => s.length >= 2);
      if (!nonEmpty.length) { signature = null; }
      else { signature = { w: canvas._w, h: canvas._h, s: nonEmpty }; }
      renderSignaturePreview();
      close();
    });
  }

  // =========================================================================
  // Wave balance (per mission)
  // =========================================================================
  async function loadWaveBalance() {
    const base = apiBase();
    let val = null;
    if (base) {
      try {
        const r = await fetch(base + "/balance?mission=" + encodeURIComponent(mission));
        if (r.ok) { const j = await r.json(); val = j.wave; }
      } catch (_) {}
    }
    if (val == null) {
      const local = localStorage.getItem(balanceKey());
      val = local == null ? null : parseInt(local, 10);
    }
    renderWaveBalance(val);
  }
  function renderWaveBalance(val) {
    const el = $("waveBalance");
    if (val == null || isNaN(val)) { el.textContent = "—"; el.classList.add("empty"); }
    else { el.textContent = groupDigits(val); el.classList.remove("empty"); }
  }
  function currentWave() {
    const t = $("waveBalance").textContent.replace(/[^\d-]/g, "");
    return t ? parseInt(t, 10) : 0;
  }
  async function saveWaveBalance(val) {
    localStorage.setItem(balanceKey(), String(val));
    renderWaveBalance(val);
    const base = apiBase();
    if (base) {
      try {
        await fetch(base + "/balance", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wave: val, mission })
        });
      } catch (_) {}
    }
  }
  function wireWave() {
    $("editWaveBtn").addEventListener("click", () => {
      $("waveInput").value = String(currentWave() || "");
      $("waveEditRow").classList.remove("hidden");
      $("waveInput").focus();
    });
    $("cancelWaveBtn").addEventListener("click", () => $("waveEditRow").classList.add("hidden"));
    $("saveWaveBtn").addEventListener("click", () => {
      const v = parseInt($("waveInput").value.replace(/\D/g, ""), 10);
      if (!isNaN(v)) saveWaveBalance(v);
      $("waveEditRow").classList.add("hidden");
    });
  }

  // =========================================================================
  // Submit + offline outbox (per mission)
  // =========================================================================
  function loadOutbox(m) {
    try { return JSON.parse(localStorage.getItem(outboxKey(m)) || "[]"); }
    catch (_) { return []; }
  }
  function saveOutbox(arr, m) { localStorage.setItem(outboxKey(m), JSON.stringify(arr)); renderOutbox(); }
  function renderOutbox() {
    const n = loadOutbox().length;
    const box = $("outbox");
    if (n === 0) { box.classList.add("hidden"); return; }
    $("outboxText").textContent = `${n} ${titleCase(mission)} transaction${n > 1 ? "s" : ""} waiting to sync`;
    box.classList.remove("hidden");
  }

  async function postTransaction(tx) {
    const base = apiBase();
    if (!base) throw new Error("offline");
    const r = await fetch(base + "/transactions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tx)
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json().catch(() => ({}));
  }

  async function syncOutbox(silent) {
    const items = loadOutbox();
    if (!items.length) { if (!silent) toast("Nothing to sync"); return; }
    if (!apiBase()) { if (!silent) toast("Set a backend URL first", "err"); return; }
    const remaining = [];
    for (const tx of items) { try { await postTransaction(tx); } catch (_) { remaining.push(tx); } }
    saveOutbox(remaining);
    if (remaining.length === 0) toast(`Synced ${items.length}`, "ok");
    else toast(`Synced ${items.length - remaining.length}, ${remaining.length} left`, "err");
  }

  function validate() {
    if (!mission) return "Select a mission";
    if (!$("beneficiary").value.trim()) return "Enter a beneficiary";
    if (!$("account").value) return "Select an account";
    if (amountValue() === 0) return "Enter an amount";
    if (!method) return "Select a method";
    return null;
  }

  function resetForm() {
    $("txForm").reset();
    $("accountChip").classList.add("hidden");
    amountSign = 1; amountDigits = ""; method = "";
    receiptImage = ""; secondImage = ""; signature = null;
    renderAmount();
    document.querySelectorAll("#methodRow .seg").forEach((x) => x.setAttribute("aria-pressed", "false"));
    ["receiptPreview", "secondPreview"].forEach((id) => { $(id).innerHTML = ""; $(id).classList.add("hidden"); });
    $("secondReceiptField").classList.add("hidden");
    $("methodNote").classList.add("hidden");
    renderSignaturePreview();
  }

  function wireSubmit() {
    $("txForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = validate();
      if (err) { toast(err, "err"); return; }

      const accountCode = $("account").value;
      const tx = {
        mission,
        beneficiary: $("beneficiary").value.trim(),
        accountCode,
        accountName: ACCOUNT_CODES[accountCode],
        description: $("description").value.trim(),
        amount: amountValue(),
        currency: CURRENCY,
        method,
        receiptImage,
        secondReceiptImage: SECOND_RECEIPT[method] ? secondImage : "",
        signature,                      // compact vector strokes (or null)
        clientCreatedAt: new Date().toISOString(),
        logged: false
      };

      const btn = $("submitBtn");
      btn.disabled = true; btn.textContent = "Saving...";
      try { await postTransaction(tx); toast(`Saved to cloud (${titleCase(mission)})`, "ok"); }
      catch (_) { const ob = loadOutbox(); ob.push(tx); saveOutbox(ob); toast("Saved offline - will sync later", "ok"); }

      if (method === "wave") await saveWaveBalance(currentWave() - tx.amount);
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
      $("apiUrlInput").value = localStorage.getItem("workingfund_api_base") || cfg.API_BASE_URL || "";
      modal.classList.remove("hidden");
    });
    $("closeSettings").addEventListener("click", () => modal.classList.add("hidden"));
    $("saveSettings").addEventListener("click", () => {
      const v = $("apiUrlInput").value.trim();
      if (v) localStorage.setItem("workingfund_api_base", v);
      else localStorage.removeItem("workingfund_api_base");
      modal.classList.add("hidden");
      refreshConnState(); loadWaveBalance(); toast("Settings saved", "ok");
    });
  }
  function refreshConnState() {
    const el = $("connState");
    if (apiBase()) { el.innerHTML = '<span class="dot"></span>Connected'; el.className = "conn-state online"; }
    else { el.innerHTML = '<span class="dot"></span>Offline'; el.className = "conn-state offline"; }
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
    wireMission();
    wirePhoto([$("receiptCam"), $("receiptGal")], "receiptPreview", (v) => { receiptImage = v; });
    wirePhoto([$("secondCam"), $("secondGal")], "secondPreview", (v) => { secondImage = v; });
    wireSignature();
    wireWave();
    wireSubmit();
    wireSettings();
    renderAmount();
    renderSignaturePreview();
    refreshConnState();
    setMission(currentMission());
    if (apiBase()) syncOutbox(true);
  });
})();

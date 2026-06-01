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
  const ACCOUNT_ORDER = Object.keys(ACCOUNT_CODES); // preserves listed order

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
  const SECOND_RECEIPT = { wave: "Wave receipt", orange: "Orange Money receipt" };
  const METHOD_LABELS = { cash: "Cash", wave: "Wave", orange: "Orange Money" };

  // Default presets (seeded by version; the user can add/remove their own).
  // Bumping PRESETS_VERSION re-seeds these over any previously stored defaults.
  const PRESETS_VERSION = "2";
  const DEFAULT_PRESETS = [
    { id: "p_sacred",  label: "Return of sacred funds",      accountCode: "02", description: "", amount: 0, method: "cash" },
    { id: "p_zhealth", label: "Zone funds health",          accountCode: "51", description: "", amount: 0, method: "cash" },
    { id: "p_ztravel", label: "Zone funds travel",          accountCode: "00", description: "", amount: 0, method: "cash" },
    { id: "p_prepaid", label: "Prepaid power meter recharge", accountCode: "03", description: "", amount: 0, method: "wave" },
    { id: "p_power",   label: "Power bill",                 accountCode: "03", description: "", amount: 0, method: "wave" }
  ];

  // ---- helpers ----
  const $ = (id) => document.getElementById(id);
  const groupDigits = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const apiBase = () =>
    (localStorage.getItem("workingfund_api_base") || cfg.API_BASE_URL || "").replace(/\/$/, "");

  // ---- state ----
  let amountSign = 1;
  let amountDigits = "";
  let method = "";
  let selectedAccount = "";
  let receiptImage = "";
  let secondImage = "";
  let signature = null;
  let mission = "";

  const balanceKey = (m) => "workingfund_wave_balance_" + (m || mission);
  const outboxKey  = (m) => "workingfund_outbox_" + (m || mission);
  const recentKey  = (m) => "workingfund_recent_" + (m || mission);

  // =========================================================================
  // Mission
  // =========================================================================
  function currentMission() {
    const saved = localStorage.getItem("workingfund_mission");
    if (MISSIONS.indexOf(saved) !== -1) return saved;
    return MISSIONS.indexOf(cfg.DEFAULT_MISSION) !== -1 ? cfg.DEFAULT_MISSION : "east";
  }
  function wireMission() {
    document.querySelectorAll("#missionRow .seg").forEach((b) =>
      b.addEventListener("click", () => setMission(b.dataset.mission)));
  }
  function setMission(m) {
    if (MISSIONS.indexOf(m) === -1) m = "east";
    mission = m;
    localStorage.setItem("workingfund_mission", m);
    document.querySelectorAll("#missionRow .seg").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.mission === m)));
    $("waveMissionTag").textContent = "(" + titleCase(m) + ")";
    $("recentMissionTag").textContent = "(" + titleCase(m) + ")";
    loadWaveBalance();
    renderOutbox();
    renderRecent();
  }

  // =========================================================================
  // Account combobox — filter by code, two columns (code | account name)
  // =========================================================================
  function accountRowHtml(code) {
    const name = ACCOUNT_CODES[code];
    const color = seriesColor(name);
    return `<div class="combo-opt" role="option" data-code="${code}" style="border-left-color:${color}">` +
      `<span class="c-code">${code}</span><span class="c-name">${name}</span></div>`;
  }
  function buildAccountCombo() {
    $("accountList").innerHTML = ACCOUNT_ORDER.map(accountRowHtml).join("");
    bindAccountOptions();
  }
  function bindAccountOptions() {
    $("accountList").querySelectorAll(".combo-opt").forEach((el) =>
      el.addEventListener("click", () => { setAccount(el.dataset.code); closeCombo(); }));
  }
  function filterAccounts(q) {
    q = (q || "").trim().toLowerCase();
    const codes = !q ? ACCOUNT_ORDER : ACCOUNT_ORDER.filter((code) => {
      const name = ACCOUNT_CODES[code].toLowerCase();
      return code.indexOf(q) !== -1 || name.indexOf(q) !== -1;
    });
    $("accountList").innerHTML = codes.map(accountRowHtml).join("");
    bindAccountOptions();
    $("accountEmpty").classList.toggle("hidden", codes.length > 0);
  }
  function setAccount(code) {
    selectedAccount = code || "";
    const label = $("accountTriggerLabel");
    const chip = $("accountChip");
    if (!code) {
      label.textContent = "Select an account"; label.classList.add("placeholder");
      chip.classList.add("hidden");
      return;
    }
    const name = ACCOUNT_CODES[code];
    label.classList.remove("placeholder");
    label.innerHTML = `<span class="tl-code">${code}</span><span class="tl-name">${name}</span>`;
    const color = seriesColor(name);
    chip.style.borderLeftColor = color;
    chip.innerHTML = `<span class="swatch" style="background:${color}"></span>` +
      `<span class="code">${code}</span><span>${name}</span>`;
    chip.classList.remove("hidden");
  }
  function openCombo() {
    $("accountPanel").classList.remove("hidden");
    $("accountTrigger").setAttribute("aria-expanded", "true");
    $("accountFilter").value = "";
    filterAccounts("");
    setTimeout(() => $("accountFilter").focus(), 30);
  }
  function closeCombo() {
    $("accountPanel").classList.add("hidden");
    $("accountTrigger").setAttribute("aria-expanded", "false");
  }
  function wireAccountCombo() {
    buildAccountCombo();
    $("accountTrigger").addEventListener("click", () => {
      const open = !$("accountPanel").classList.contains("hidden");
      if (open) closeCombo(); else openCombo();
    });
    $("accountFilter").addEventListener("input", (e) => filterAccounts(e.target.value));
    $("accountFilter").addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeCombo(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const first = $("accountList").querySelector(".combo-opt");
        if (first) { setAccount(first.dataset.code); closeCombo(); }
      }
    });
    document.addEventListener("click", (e) => {
      if (!$("accountCombo").contains(e.target)) closeCombo();
    });
  }

  // =========================================================================
  // Amount
  // =========================================================================
  function renderAmount() {
    const preview = $("amountPreview");
    const n = amountDigits ? parseInt(amountDigits, 10) : 0;
    preview.textContent = `${amountSign < 0 ? "-" : ""}${groupDigits(n)} ${CURRENCY}`;
    preview.classList.toggle("neg", amountSign < 0 && n !== 0);
    const btn = $("signBtn");
    btn.textContent = amountSign < 0 ? "−" : "+";
    btn.classList.toggle("neg", amountSign < 0);
  }
  function setAmount(value) {
    const v = parseInt(value, 10);
    if (isNaN(v) || v === 0) { amountDigits = ""; $("amount").value = ""; amountSign = 1; }
    else { amountSign = v < 0 ? -1 : 1; amountDigits = String(Math.abs(v)); $("amount").value = groupDigits(amountDigits); }
    renderAmount();
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
  // Method
  // =========================================================================
  function selectMethod(m) {
    method = m;
    document.querySelectorAll("#methodRow .seg").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.method === m)));
    const label = SECOND_RECEIPT[m];
    $("secondReceiptField").classList.toggle("hidden", !label);
    if (label) $("secondReceiptLabel").textContent = label;
    $("methodNote").classList.toggle("hidden", m !== "wave");
  }
  function wireMethods() {
    document.querySelectorAll("#methodRow .seg").forEach((b) =>
      b.addEventListener("click", () => selectMethod(b.dataset.method)));
  }

  // =========================================================================
  // Presets
  // =========================================================================
  function loadPresets() {
    const ver = localStorage.getItem("workingfund_presets_version");
    const raw = localStorage.getItem("workingfund_presets");
    // Re-seed when missing or when the default set has been versioned up.
    if (raw == null || ver !== PRESETS_VERSION) { savePresets(DEFAULT_PRESETS); return DEFAULT_PRESETS.slice(); }
    try { return JSON.parse(raw); } catch (_) { return DEFAULT_PRESETS.slice(); }
  }
  function savePresets(arr) {
    localStorage.setItem("workingfund_presets", JSON.stringify(arr));
    localStorage.setItem("workingfund_presets_version", PRESETS_VERSION);
  }

  function renderPresets() {
    const row = $("presetsRow");
    const presets = loadPresets();
    row.innerHTML = "";
    presets.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "preset-chip";
      b.textContent = p.label;
      b.title = presetSummary(p);
      b.addEventListener("click", () => applyPreset(p));
      row.appendChild(b);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "preset-chip add";
    add.textContent = "+ Add";
    add.addEventListener("click", openPresetModal);
    row.appendChild(add);
  }
  function presetSummary(p) {
    const parts = [];
    if (p.accountCode) parts.push(p.accountCode + " " + (ACCOUNT_CODES[p.accountCode] || ""));
    if (p.amount) parts.push(groupDigits(p.amount) + " " + CURRENCY);
    if (p.method) parts.push(METHOD_LABELS[p.method] || p.method);
    return parts.join(" · ");
  }
  function applyPreset(p) {
    if (p.accountCode && ACCOUNT_CODES[p.accountCode]) setAccount(p.accountCode);
    if (typeof p.description === "string") $("description").value = p.description;
    if (p.amount) setAmount(p.amount); else setAmount(0);
    if (p.method) selectMethod(p.method);
    toast("Applied: " + p.label, "ok");
  }

  // ---- preset add / manage modal ----
  function buildPresetAccountSelect() {
    const sel = $("pAccount");
    sel.innerHTML = '<option value="">None</option>' +
      ACCOUNT_ORDER.map((c) => `<option value="${c}">${c}  ${ACCOUNT_CODES[c]}</option>`).join("");
  }
  function renderPresetManageList() {
    const wrap = $("presetManageList");
    const presets = loadPresets();
    if (!presets.length) { wrap.innerHTML = `<div class="hint">No presets yet.</div>`; return; }
    wrap.innerHTML = presets.map((p) =>
      `<div class="preset-manage-row">` +
      `<div class="pm-text"><strong>${escapeHtml(p.label)}</strong>` +
      `<span class="pm-sub">${escapeHtml(presetSummary(p))}</span></div>` +
      `<button type="button" class="link-btn danger" data-del="${p.id}">Delete</button></div>`
    ).join("");
    wrap.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        savePresets(loadPresets().filter((x) => x.id !== b.dataset.del));
        renderPresetManageList(); renderPresets();
      }));
  }
  function openPresetModal() {
    buildPresetAccountSelect();
    // Pre-fill the form from whatever is currently entered, for a quick "save as preset".
    $("pName").value = "";
    $("pAccount").value = selectedAccount || "";
    $("pDesc").value = $("description").value.trim();
    const a = amountValue();
    $("pAmount").value = a ? String(Math.abs(a)) : "";
    $("pMethod").value = method || "";
    renderPresetManageList();
    $("presetModal").classList.remove("hidden");
    setTimeout(() => $("pName").focus(), 30);
  }
  function wirePresets() {
    renderPresets();
    $("cancelPreset").addEventListener("click", () => $("presetModal").classList.add("hidden"));
    $("savePreset").addEventListener("click", () => {
      const label = $("pName").value.trim();
      if (!label) { toast("Enter a preset name", "err"); return; }
      const amt = parseInt(($("pAmount").value || "").replace(/\D/g, ""), 10);
      const preset = {
        id: "p_" + Math.abs(hashStr(label + ":" + Date.now())).toString(36),
        label,
        accountCode: $("pAccount").value || "",
        description: $("pDesc").value.trim(),
        amount: isNaN(amt) ? 0 : amt,
        method: $("pMethod").value || ""
      };
      const arr = loadPresets(); arr.push(preset); savePresets(arr);
      renderPresets(); renderPresetManageList();
      $("pName").value = "";
      toast("Preset saved", "ok");
    });
  }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }

  // =========================================================================
  // Photos
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
          if (width >= height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
          const c = document.createElement("canvas");
          c.width = width; c.height = height;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
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
      preview.innerHTML = `<img src="${dataUrl}" alt="receipt">` +
        `<div class="meta"><span>${kbOf(dataUrl)} KB</span><button type="button" class="remove">Remove</button></div>`;
      preview.classList.remove("hidden");
      preview.querySelector(".remove").addEventListener("click", () => {
        setter(""); preview.innerHTML = ""; preview.classList.add("hidden");
      });
    }
    inputs.forEach((inp) => inp.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try { show(await compressImage(file, 1100, 0.55)); }
      catch (_) { toast("Could not read that image", "err"); }
      e.target.value = "";
    }));
  }

  // =========================================================================
  // Signature pad (compact integer vector strokes)
  // =========================================================================
  function drawSignature(canvas, sig, pad) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sig || !sig.s || !sig.s.length) return;
    pad = pad || 0;
    const scale = Math.min((canvas.width - 2 * pad) / sig.w, (canvas.height - 2 * pad) / sig.h);
    const ox = (canvas.width - sig.w * scale) / 2, oy = (canvas.height - sig.h * scale) / 2;
    ctx.lineWidth = Math.max(1.4, 2 * scale); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a2228";
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
    const w = wrap.clientWidth || 320, h = 80;
    const lc = document.createElement("canvas"); lc.width = w; lc.height = h;
    drawSignature(lc, signature, 6);
    wrap.innerHTML = "";
    lc.style.width = w + "px"; lc.style.height = h + "px";
    wrap.appendChild(lc);
    $("removeSigBtn").classList.remove("hidden");
    $("collectSigBtn").textContent = "Re-collect";
  }
  function wireSignature() {
    const modal = $("sigModal");
    const canvas = $("sigCanvas");
    const ctx = canvas.getContext("2d");
    let strokes = [], current = null, drawing = false, lastX = 0, lastY = 0;

    function sizeCanvas() {
      const wrap = $("sigCanvasWrap");
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a2228";
      canvas._w = w; canvas._h = h; redraw();
    }
    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      strokes.forEach((flat) => {
        ctx.beginPath();
        for (let i = 0; i < flat.length; i += 2) { if (i === 0) ctx.moveTo(flat[i], flat[i + 1]); else ctx.lineTo(flat[i], flat[i + 1]); }
        ctx.stroke();
      });
    }
    function pos(e) { const r = canvas.getBoundingClientRect(); return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) }; }
    function down(e) { e.preventDefault(); drawing = true; current = []; const p = pos(e); lastX = p.x; lastY = p.y; current.push(p.x, p.y); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) {
      if (!drawing) return; e.preventDefault(); const p = pos(e);
      if (Math.abs(p.x - lastX) + Math.abs(p.y - lastY) < 2) return;
      lastX = p.x; lastY = p.y; current.push(p.x, p.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    function up() { if (!drawing) return; drawing = false; if (current && current.length >= 2) strokes.push(current); current = null; }

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);

    $("collectSigBtn").addEventListener("click", () => {
      strokes = signature ? signature.s.map((a) => a.slice()) : [];
      modal.classList.remove("hidden");
      requestAnimationFrame(sizeCanvas);
    });
    $("removeSigBtn").addEventListener("click", () => { signature = null; renderSignaturePreview(); });
    $("sigClear").addEventListener("click", () => { strokes = []; redraw(); });
    $("sigCancel").addEventListener("click", () => modal.classList.add("hidden"));
    $("sigSave").addEventListener("click", () => {
      const nonEmpty = strokes.filter((s) => s.length >= 2);
      signature = nonEmpty.length ? { w: canvas._w, h: canvas._h, s: nonEmpty } : null;
      renderSignaturePreview();
      modal.classList.add("hidden");
    });
  }

  // =========================================================================
  // Wave balance (per mission)
  // =========================================================================
  async function loadWaveBalance() {
    const base = apiBase();
    let val = null;
    if (base) {
      try { const r = await fetch(base + "/balance?mission=" + encodeURIComponent(mission)); if (r.ok) { val = (await r.json()).wave; } }
      catch (_) {}
    }
    if (val == null) { const local = localStorage.getItem(balanceKey()); val = local == null ? null : parseInt(local, 10); }
    renderWaveBalance(val);
  }
  function renderWaveBalance(val) {
    const el = $("waveBalance");
    if (val == null || isNaN(val)) { el.textContent = "—"; el.classList.add("empty"); }
    else { el.textContent = groupDigits(val); el.classList.remove("empty"); }
  }
  function currentWave() { const t = $("waveBalance").textContent.replace(/[^\d-]/g, ""); return t ? parseInt(t, 10) : 0; }
  async function saveWaveBalance(val) {
    localStorage.setItem(balanceKey(), String(val));
    renderWaveBalance(val);
    const base = apiBase();
    if (base) { try { await fetch(base + "/balance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wave: val, mission }) }); } catch (_) {} }
  }
  function wireWave() {
    $("editWaveBtn").addEventListener("click", () => {
      $("waveInput").value = String(currentWave() || "");
      $("waveEditRow").classList.remove("hidden"); $("waveInput").focus();
    });
    $("cancelWaveBtn").addEventListener("click", () => $("waveEditRow").classList.add("hidden"));
    $("saveWaveBtn").addEventListener("click", () => {
      const v = parseInt($("waveInput").value.replace(/\D/g, ""), 10);
      if (!isNaN(v)) saveWaveBalance(v);
      $("waveEditRow").classList.add("hidden");
    });
  }

  // =========================================================================
  // Recent transactions — local only (no network), per mission
  // =========================================================================
  function loadRecent(m) { try { return JSON.parse(localStorage.getItem(recentKey(m)) || "[]"); } catch (_) { return []; } }
  function pushRecent(tx) {
    const arr = loadRecent();
    arr.unshift({
      at: tx.clientCreatedAt, beneficiary: tx.beneficiary,
      accountCode: tx.accountCode, amount: tx.amount, currency: tx.currency, method: tx.method
    });
    localStorage.setItem(recentKey(), JSON.stringify(arr.slice(0, 10))); // cap 10 -> tiny footprint
  }
  function fmtRecentDate(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function renderRecent() {
    const list = $("recentList");
    const items = loadRecent();
    if (!items.length) { list.innerHTML = `<div class="recent-empty">No recent transactions</div>`; return; }
    list.innerHTML = items.map((r) => {
      const neg = r.amount < 0;
      const amt = (neg ? "-" : "") + groupDigits(Math.abs(r.amount));
      const color = seriesColor(ACCOUNT_CODES[r.accountCode]);
      return `<div class="recent-row">` +
        `<span class="r-code" style="color:${color}">${r.accountCode || "--"}</span>` +
        `<span class="r-main"><span class="r-who">${escapeHtml(r.beneficiary || "")}</span>` +
        `<span class="r-meta">${fmtRecentDate(r.at)} · ${METHOD_LABELS[r.method] || r.method || ""}</span></span>` +
        `<span class="r-amt ${neg ? "neg" : ""}">${amt}</span></div>`;
    }).join("");
  }
  function wireRecent() {
    $("clearRecent").addEventListener("click", () => {
      localStorage.removeItem(recentKey()); renderRecent(); toast("Recent cleared", "ok");
    });
  }

  // =========================================================================
  // Submit + offline outbox (per mission)
  // =========================================================================
  function loadOutbox(m) { try { return JSON.parse(localStorage.getItem(outboxKey(m)) || "[]"); } catch (_) { return []; } }
  function saveOutbox(arr, m) { localStorage.setItem(outboxKey(m), JSON.stringify(arr)); renderOutbox(); }
  function renderOutbox() {
    const n = loadOutbox().length, box = $("outbox");
    if (n === 0) { box.classList.add("hidden"); return; }
    $("outboxText").textContent = `${n} ${titleCase(mission)} transaction${n > 1 ? "s" : ""} waiting to sync`;
    box.classList.remove("hidden");
  }
  async function postTransaction(tx) {
    const base = apiBase();
    if (!base) throw new Error("offline");
    const r = await fetch(base + "/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tx) });
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
    if (!selectedAccount) return "Select an account";
    if (amountValue() === 0) return "Enter an amount";
    if (!method) return "Select a method";
    return null;
  }
  function resetForm() {
    $("txForm").reset();
    setAccount("");
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
      const tx = {
        mission, beneficiary: $("beneficiary").value.trim(),
        accountCode: selectedAccount, accountName: ACCOUNT_CODES[selectedAccount],
        description: $("description").value.trim(), amount: amountValue(),
        currency: CURRENCY, method, receiptImage,
        secondReceiptImage: SECOND_RECEIPT[method] ? secondImage : "",
        signature, clientCreatedAt: new Date().toISOString(), logged: false
      };
      const btn = $("submitBtn"); btn.disabled = true; btn.textContent = "Saving...";
      try { await postTransaction(tx); toast(`Saved to cloud (${titleCase(mission)})`, "ok"); }
      catch (_) { const ob = loadOutbox(); ob.push(tx); saveOutbox(ob); toast("Saved offline - will sync later", "ok"); }
      pushRecent(tx); renderRecent();        // local recent list, no extra call
      if (method === "wave") await saveWaveBalance(currentWave() - tx.amount);
      resetForm();
      btn.disabled = false; btn.textContent = "Save transaction";
    });
    $("syncBtn").addEventListener("click", () => syncOutbox(false));
  }

  // =========================================================================
  // Settings + connection
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
      if (v) localStorage.setItem("workingfund_api_base", v); else localStorage.removeItem("workingfund_api_base");
      modal.classList.add("hidden"); refreshConnState(); loadWaveBalance(); toast("Settings saved", "ok");
    });
  }
  function refreshConnState() {
    const el = $("connState");
    if (apiBase()) { el.innerHTML = '<span class="dot"></span>Connected'; el.className = "conn-state online"; }
    else { el.innerHTML = '<span class="dot"></span>Offline'; el.className = "conn-state offline"; }
  }

  // ---- misc ----
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $("toast"); t.textContent = msg; t.className = "toast" + (kind ? " " + kind : "");
    if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // ---- init ----
  document.addEventListener("DOMContentLoaded", () => {
    wireAccountCombo();
    wireAmount();
    wireMethods();
    wireMission();
    wirePresets();
    wireRecent();
    wirePhoto([$("receiptCam"), $("receiptGal")], "receiptPreview", (v) => { receiptImage = v; });
    wirePhoto([$("secondCam"), $("secondGal")], "secondPreview", (v) => { secondImage = v; });
    wireSignature();
    wireWave();
    wireSubmit();
    wireSettings();
    renderAmount();
    renderSignaturePreview();
    refreshConnState();
    setMission(currentMission());  // loads balance + outbox + recent for the mission
    if (apiBase()) syncOutbox(true);
  });
})();

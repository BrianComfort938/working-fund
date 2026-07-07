(function () {
  "use strict";

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
  const ACCOUNT_ORDER = Object.keys(ACCOUNT_CODES).sort();

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

  const PRESETS_VERSION = "2";
  const DEFAULT_PRESETS = [
    { id: "p_sacred",  label: "Return of sacred funds",      accountCode: "02", description: "", amount: 0, method: "cash" },
    { id: "p_prepaid", label: "Prepaid power meter recharge", accountCode: "03", description: "", amount: 0, method: "wave" },
    { id: "p_power",   label: "Power bill",                 accountCode: "03", description: "", amount: 0, method: "wave" }
  ];
  // The old "Zone funds health/travel" presets are retired in favour of the
  // dedicated Add zone fund flow. Retired ids are stripped from saved presets once
  // on load (see wirePresets) so a user's own presets are never disturbed.
  const RETIRED_PRESET_IDS = ["p_zhealth", "p_ztravel"];

  // Zone funds: the phone records {zone, sheetId, type}; the secure API attaches
  // that sheet's Transport/Sante tab as a PDF. The type also sets the account.
  const ZONES = window.WORKINGFUND_ZONES || [];
  const ZONE_TYPE_ACCOUNT = { transport: "00", sante: "51" };
  const ZONE_TYPE_LABEL = { transport: "Transport", sante: "Health (Santé)" };

  const $ = (id) => document.getElementById(id);
  const groupDigits = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  localStorage.removeItem("workingfund_api_base");
  const apiBase = () => (cfg.API_BASE_URL || "").replace(/\/$/, "");

  let amountSign = 1;
  let amountDigits = "";
  let method = "";
  let selectedAccount = "";
  let receiptImage = "";
  let secondImage = "";
  let zoneFund = null;
  let zoneFundPdf = "";       // the pre-fetched sheet (data URL), when ready
  let zoneAttachState = "";   // "" | loading | ready | deferred
  let signature = null;
  let signatureIsDefault = false;
  let openSignaturePad = function () {}; // assigned by wireSignature()
  let mission = "";
  let lastPosition = null;
  let geoWatchId = null;

  const HISTORY_KEY = "workingfund_history";
  const HISTORY_CAP = 100;

  const balanceKey = (m) => "workingfund_wave_balance_" + (m || mission);
  const outboxKey  = (m) => "workingfund_outbox_" + (m || mission);
  const recentKey  = (m) => "workingfund_recent_" + (m || mission);

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
    const cur = $("missionCurrent");
    if (cur) cur.textContent = titleCase(m);
    loadWaveBalance();
    renderOutbox();
    renderRecent();
  }

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

  function selectMethod(m) {
    method = m;
    document.querySelectorAll("#methodRow .seg").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.method === m)));
    const label = SECOND_RECEIPT[m];
    $("secondReceiptField").classList.toggle("hidden", !label);
    if (label) $("secondReceiptLabel").textContent = label;
  }
  function wireMethods() {
    document.querySelectorAll("#methodRow .seg").forEach((b) =>
      b.addEventListener("click", () => selectMethod(b.dataset.method)));
  }

  function loadPresets() {
    const ver = localStorage.getItem("workingfund_presets_version");
    const raw = localStorage.getItem("workingfund_presets");
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
    $("description").value = p.description || "";
    if (p.amount) setAmount(p.amount); else setAmount(0);
    if (p.method) selectMethod(p.method);
    toast("Applied: " + p.label, "ok");
  }

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
      `<div class="pm-text">${escapeHtml(p.label)}` +
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
    // One-time: drop the retired zone presets from saved presets, keeping the user's own.
    try {
      const raw = localStorage.getItem("workingfund_presets");
      if (raw) {
        const arr = JSON.parse(raw);
        const cleaned = arr.filter((p) => RETIRED_PRESET_IDS.indexOf(p.id) === -1);
        if (cleaned.length !== arr.length) savePresets(cleaned);
      }
    } catch (_) {}
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

  // --- Default signatures -----------------------------------------------------
  // A small per-device library of { id, name, sig } stored in localStorage as
  // JSON (signatures are tiny vector strokes, never sent to the cloud as a
  // library). When a transaction's beneficiary matches a saved name and the user
  // has not drawn a signature, the matching one is applied automatically.
  const SIGS_KEY = "workingfund_signatures";
  const normName = (s) => String(s == null ? "" : s).trim().toLowerCase();
  function loadSignatures() { try { return JSON.parse(localStorage.getItem(SIGS_KEY) || "[]"); } catch (_) { return []; } }
  function saveSignatures(arr) { localStorage.setItem(SIGS_KEY, JSON.stringify(arr)); }
  function findDefaultSignature(name) {
    const key = normName(name);
    if (!key) return null;
    return loadSignatures().find((x) => normName(x.name) === key) || null;
  }
  function maybeApplyDefaultSignature() {
    // Never override a signature the user drew themselves.
    if (signature && !signatureIsDefault) return;
    const match = findDefaultSignature($("beneficiary").value);
    if (match && match.sig) {
      signature = match.sig; signatureIsDefault = true;
    } else if (signatureIsDefault) {
      // A default was auto-applied but the name no longer matches: clear it.
      signature = null; signatureIsDefault = false;
    }
    renderSignaturePreview();
  }

  let editingSigId = null;
  let pendingSig = null; // signature being composed in the library form

  function renderSigFormPreview() {
    const wrap = $("sigLibPreview");
    if (!pendingSig) {
      wrap.classList.add("empty");
      wrap.innerHTML = `<span class="sig-empty-text">No signature</span>`;
      $("sigLibRemove").classList.add("hidden");
      $("sigLibCollect").textContent = "Collect signature";
      return;
    }
    wrap.classList.remove("empty");
    const w = wrap.clientWidth || 320, h = 80;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    drawSignature(c, pendingSig, 6);
    wrap.innerHTML = ""; c.style.width = w + "px"; c.style.height = h + "px";
    wrap.appendChild(c);
    $("sigLibRemove").classList.remove("hidden");
    $("sigLibCollect").textContent = "Re-collect";
  }
  function resetSigForm() {
    editingSigId = null; pendingSig = null;
    $("sigLibName").value = "";
    $("sigLibSave").textContent = "Save signature";
    $("sigLibCancelEdit").classList.add("hidden");
    renderSigFormPreview();
  }
  function startEditSig(id) {
    const s = loadSignatures().find((x) => x.id === id);
    if (!s) return;
    editingSigId = id; pendingSig = s.sig || null;
    $("sigLibName").value = s.name || "";
    $("sigLibSave").textContent = "Update signature";
    $("sigLibCancelEdit").classList.remove("hidden");
    renderSigFormPreview();
    $("sigLibName").focus();
  }
  function renderSigLibList() {
    const wrap = $("sigLibList");
    const sigs = loadSignatures();
    if (!sigs.length) { wrap.innerHTML = `<div class="hint">No default signatures yet.</div>`; return; }
    wrap.innerHTML = sigs.map((s) => {
      const strokes = s.sig && s.sig.s ? s.sig.s.length : 0;
      return `<div class="sig-lib-row">` +
        `<div class="pm-text">${escapeHtml(s.name)}` +
        `<span class="pm-sub">${strokes} stroke${strokes === 1 ? "" : "s"}</span></div>` +
        `<canvas class="sig-mini" width="96" height="38" data-mini="${s.id}"></canvas>` +
        `<button type="button" class="link-btn" data-edit="${s.id}">Edit</button>` +
        `<button type="button" class="link-btn danger" data-del="${s.id}">Delete</button>` +
        `</div>`;
    }).join("");
    sigs.forEach((s) => { const c = wrap.querySelector(`[data-mini="${s.id}"]`); if (c && s.sig) drawSignature(c, s.sig, 4); });
    wrap.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => startEditSig(b.dataset.edit)));
    wrap.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        saveSignatures(loadSignatures().filter((x) => x.id !== b.dataset.del));
        if (editingSigId === b.dataset.del) resetSigForm();
        renderSigLibList();
        maybeApplyDefaultSignature();
        toast("Signature deleted", "ok");
      }));
  }
  function openSigLib() {
    resetSigForm();
    renderSigLibList();
    $("sigLibModal").classList.remove("hidden");
    setTimeout(() => $("sigLibName").focus(), 30);
  }
  function wireSigLib() {
    $("openSigLib").addEventListener("click", openSigLib);
    $("sigLibClose").addEventListener("click", () => $("sigLibModal").classList.add("hidden"));
    $("sigLibCancelEdit").addEventListener("click", resetSigForm);
    $("sigLibCollect").addEventListener("click", () =>
      openSignaturePad(pendingSig, (sig) => { pendingSig = sig; renderSigFormPreview(); }));
    $("sigLibRemove").addEventListener("click", () => { pendingSig = null; renderSigFormPreview(); });
    $("sigLibSave").addEventListener("click", () => {
      const name = $("sigLibName").value.trim();
      if (!name) { toast("Enter a name", "err"); return; }
      if (!pendingSig) { toast("Collect a signature first", "err"); return; }
      const arr = loadSignatures();
      const clash = arr.find((x) => normName(x.name) === normName(name) && x.id !== editingSigId);
      if (clash) { toast("A signature for that name already exists", "err"); return; }
      if (editingSigId) {
        const i = arr.findIndex((x) => x.id === editingSigId);
        if (i !== -1) arr[i] = { id: editingSigId, name, sig: pendingSig };
      } else {
        arr.push({ id: "s_" + Math.abs(hashStr(name + ":" + Date.now())).toString(36), name, sig: pendingSig });
      }
      saveSignatures(arr);
      toast(editingSigId ? "Signature updated" : "Signature saved", "ok");
      resetSigForm();
      renderSigLibList();
      maybeApplyDefaultSignature();
    });
  }

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

  function clearZoneFund() { zoneFund = null; zoneFundPdf = ""; zoneAttachState = ""; }

  function renderZoneFundPreview() {
    const el = $("zoneFundPreview");
    const btn = $("addZoneFund");
    if (!el) return;
    if (!zoneFund) {
      el.classList.add("hidden");
      el.innerHTML = "";
      if (btn) btn.textContent = "Add zone fund";
      return;
    }
    const typeLabel = ZONE_TYPE_LABEL[zoneFund.type] || zoneFund.type;
    const status = zoneAttachState === "ready" ? "sheet attached"
      : zoneAttachState === "loading" ? "attaching the sheet in the background"
      : zoneAttachState === "deferred" ? "sheet attaches when reviewed"
      : "sheet attaches when reviewed";
    el.classList.remove("hidden");
    el.innerHTML = `<span class="zf-info"><span class="zf-zone">${escapeHtml(zoneFund.zone)}</span>` +
      `<span class="zf-type">${escapeHtml(typeLabel)}, ${status}</span></span>` +
      `<button type="button" class="link-btn danger" id="zoneFundRemove">Remove</button>`;
    $("zoneFundRemove").addEventListener("click", () => { clearZoneFund(); renderZoneFundPreview(); });
    if (btn) btn.textContent = "Change";
  }

  // Pre-fetch the zone sheet the moment it is added, so saving never waits. The
  // request runs in the background; if it is not ready by the time the user saves,
  // the record carries only the reference and the review portal fetches on demand.
  function startZoneAttach() {
    const zf = zoneFund;
    if (!zf) return;
    const base = apiBase();
    if (!base) { zoneAttachState = "deferred"; renderZoneFundPreview(); return; }
    const stillCurrent = () => zoneFund && zoneFund.sheetId === zf.sheetId && zoneFund.type === zf.type;
    zoneAttachState = "loading";
    renderZoneFundPreview();
    fetch(base + "/zone-pdf?sheetId=" + encodeURIComponent(zf.sheetId) + "&type=" + encodeURIComponent(zf.type))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!stillCurrent()) return;               // user changed or removed it meanwhile
        if (d && d.pdf) { zoneFundPdf = d.pdf; zoneAttachState = "ready"; }
        else { zoneAttachState = "deferred"; }
        renderZoneFundPreview();
      })
      .catch(() => { if (stillCurrent()) { zoneAttachState = "deferred"; renderZoneFundPreview(); } });
  }
  function wireZoneFund() {
    const sel = $("zoneSelect");
    if (!sel) return;
    sel.innerHTML = ZONES.map((z, i) => `<option value="${i}">${escapeHtml(z.name)}</option>`).join("");
    let ztype = "transport";
    function setZType(t) {
      ztype = t;
      document.querySelectorAll("#zoneTypeRow .seg").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.ztype === t)));
    }
    document.querySelectorAll("#zoneTypeRow .seg").forEach((b) =>
      b.addEventListener("click", () => setZType(b.dataset.ztype)));
    $("addZoneFund").addEventListener("click", () => {
      if (!ZONES.length) { toast("No zones configured", "err"); return; }
      setZType(zoneFund ? zoneFund.type : "transport");
      if (zoneFund) { const i = ZONES.findIndex((z) => z.id === zoneFund.sheetId); if (i >= 0) sel.value = String(i); }
      $("zoneModal").classList.remove("hidden");
    });
    $("zoneCancel").addEventListener("click", () => $("zoneModal").classList.add("hidden"));
    $("zoneConfirm").addEventListener("click", () => {
      const z = ZONES[parseInt(sel.value, 10)];
      if (!z) { toast("Pick a zone", "err"); return; }
      if (!ztype) { toast("Pick Transport or Health", "err"); return; }
      zoneFund = { zone: z.name, sheetId: z.id, type: ztype };
      zoneFundPdf = ""; zoneAttachState = "";
      const acct = ZONE_TYPE_ACCOUNT[ztype];
      if (acct && ACCOUNT_CODES[acct]) setAccount(acct);
      $("zoneModal").classList.add("hidden");
      renderZoneFundPreview();
      startZoneAttach();
      toast(`Zone fund: ${z.name}, ${ZONE_TYPE_LABEL[ztype]}`, "ok");
    });
  }

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
    const note = $("sigDefaultNote");
    if (!signature) {
      wrap.classList.add("empty");
      wrap.innerHTML = `<span class="sig-empty-text">No signature collected</span>`;
      $("removeSigBtn").classList.add("hidden");
      $("collectSigBtn").textContent = "Collect signature";
      if (note) note.classList.add("hidden");
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
    if (note) note.classList.toggle("hidden", !signatureIsDefault);
  }
  function wireSignature() {
    const modal = $("sigModal");
    const canvas = $("sigCanvas");
    const ctx = canvas.getContext("2d");
    let strokes = [], current = null, drawing = false, lastX = 0, lastY = 0;
    let onSaveCb = null;

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

    // Open the shared pad seeded with `initial`; `onSave` receives the new sig
    // (or null if nothing was drawn). Used by the transaction signature field and
    // the default-signatures library.
    openSignaturePad = function (initial, onSave) {
      onSaveCb = typeof onSave === "function" ? onSave : null;
      strokes = initial && initial.s ? initial.s.map((a) => a.slice()) : [];
      modal.classList.remove("hidden");
      requestAnimationFrame(sizeCanvas);
    };

    $("collectSigBtn").addEventListener("click", () =>
      openSignaturePad(signature, (sig) => { signature = sig; signatureIsDefault = false; renderSignaturePreview(); }));
    $("removeSigBtn").addEventListener("click", () => { signature = null; signatureIsDefault = false; renderSignaturePreview(); });
    $("sigClear").addEventListener("click", () => { strokes = []; redraw(); });
    $("sigCancel").addEventListener("click", () => modal.classList.add("hidden"));
    $("sigSave").addEventListener("click", () => {
      const nonEmpty = strokes.filter((s) => s.length >= 2);
      const sig = nonEmpty.length ? { w: canvas._w, h: canvas._h, s: nonEmpty } : null;
      modal.classList.add("hidden");
      if (onSaveCb) onSaveCb(sig);
    });
  }

  async function loadWaveBalance() {
    // The Wave balance is a per-device value (see Settings): the number this
    // device last saw must survive a page refresh, so a locally saved balance
    // always wins. Only ask the server when this device has never stored one.
    const localRaw = localStorage.getItem(balanceKey());
    if (localRaw != null && localRaw !== "") { renderWaveBalance(parseInt(localRaw, 10)); return; }
    let val = null;
    const base = apiBase();
    if (base) {
      try { const r = await fetch(base + "/balance?mission=" + encodeURIComponent(mission)); if (r.ok) { val = (await r.json()).wave; } }
      catch (_) {}
    }
    renderWaveBalance(val);
  }
  function renderWaveBalance(val) {
    const el = $("waveBalance");
    if (val == null || isNaN(val)) { el.textContent = "N/A"; el.classList.add("empty"); }
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

  function loadRecent(m) { try { return JSON.parse(localStorage.getItem(recentKey(m)) || "[]"); } catch (_) { return []; } }
  function pushRecent(tx) {
    const arr = loadRecent();
    arr.unshift({
      at: tx.clientCreatedAt, beneficiary: tx.beneficiary,
      accountCode: tx.accountCode, amount: tx.amount, currency: tx.currency, method: tx.method
    });
    localStorage.setItem(recentKey(), JSON.stringify(arr.slice(0, 10)));
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

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (_) { return []; }
  }
  function pushHistory(tx) {
    const entry = {
      beneficiary: tx.beneficiary || "", accountCode: tx.accountCode || "",
      description: tx.description || "", amount: Math.abs(tx.amount || 0),
      sign: (tx.amount || 0) < 0 ? -1 : 1, method: tx.method || ""
    };
    if (!entry.beneficiary && !entry.description) return;
    const arr = loadHistory();
    const key = (e) => [e.beneficiary, e.accountCode, e.description, e.amount, e.sign, e.method].join("|").toLowerCase();
    const k = key(entry);
    const deduped = arr.filter((e) => key(e) !== k);
    deduped.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(deduped.slice(0, HISTORY_CAP)));
  }
  function matchHistory(q) {
    q = (q || "").trim().toLowerCase();
    if (!q) return [];
    const seen = new Set();
    return loadHistory().filter((e) => {
      const hay = (e.beneficiary + " " + e.description + " " + (ACCOUNT_CODES[e.accountCode] || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
      const k = [e.beneficiary, e.accountCode, e.description, e.amount, e.sign, e.method].join("|").toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, 6);
  }
  function suggestionRowHtml(e) {
    const acct = e.accountCode ? `${e.accountCode} ${ACCOUNT_CODES[e.accountCode] || ""}` : "";
    const amt = e.amount ? (e.sign < 0 ? "-" : "") + groupDigits(e.amount) + " " + CURRENCY : "";
    const meta = [acct, amt, METHOD_LABELS[e.method] || ""].filter(Boolean).join(" · ");
    return `<div class="ac-opt" role="option">` +
      `<span class="ac-who">${escapeHtml(e.beneficiary || e.description || "(no name)")}</span>` +
      (meta ? `<span class="ac-meta">${escapeHtml(meta)}</span>` : "") + `</div>`;
  }
  function applyHistoryEntry(e) {
    if (e.beneficiary) $("beneficiary").value = e.beneficiary;
    if (e.accountCode && ACCOUNT_CODES[e.accountCode]) setAccount(e.accountCode);
    $("description").value = e.description || "";
    if (e.amount) { setAmount(e.amount); if (e.sign < 0) { amountSign = -1; renderAmount(); } }
    if (e.method) selectMethod(e.method);
    maybeApplyDefaultSignature();
    toast("Filled from history", "ok");
  }
  function wireAutocomplete(inputId, panelId) {
    const input = $(inputId), panel = $(panelId);
    let active = -1, items = [];
    function close() { panel.classList.add("hidden"); panel.innerHTML = ""; active = -1; items = []; }
    function open(matches) {
      items = matches;
      if (!matches.length) { close(); return; }
      panel.innerHTML = matches.map(suggestionRowHtml).join("");
      panel.classList.remove("hidden");
      active = -1;
      panel.querySelectorAll(".ac-opt").forEach((el, i) => {
        el.addEventListener("mousedown", (ev) => { ev.preventDefault(); applyHistoryEntry(items[i]); close(); });
      });
    }
    function highlight() {
      panel.querySelectorAll(".ac-opt").forEach((el, i) => el.classList.toggle("active", i === active));
    }
    input.addEventListener("input", () => open(matchHistory(input.value)));
    input.addEventListener("focus", () => { if (input.value.trim()) open(matchHistory(input.value)); });
    input.addEventListener("keydown", (e) => {
      if (panel.classList.contains("hidden")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); applyHistoryEntry(items[active]); close(); }
      else if (e.key === "Escape") { close(); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
  }

  function setGeoStatus(text, kind) {
    const el = $("geoStatus");
    if (!el) return;
    el.textContent = text || "";
    el.className = "geo-status" + (kind ? " " + kind : "");
  }
  const GOOD_ACCURACY_M = 65;
  function metersBetween(aLat, aLon, bLat, bLon) {
    const R = 6371000, toRad = Math.PI / 180;
    const dLat = (bLat - aLat) * toRad, dLon = (bLon - aLon) * toRad;
    const s = Math.sin(dLat / 2) ** 2 +
              Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function onGeoOk(pos) {
    const c = pos && pos.coords;
    if (!c) return;
    const acc = c.accuracy != null ? Math.round(c.accuracy) : null;
    if (lastPosition && lastPosition.accuracy != null && acc != null && acc > lastPosition.accuracy) {
      const moved = metersBetween(lastPosition.lat, lastPosition.lon, c.latitude, c.longitude);
      if (moved < lastPosition.accuracy + acc) return;
    }
    lastPosition = {
      lat: c.latitude, lon: c.longitude, accuracy: acc,
      at: new Date().toISOString()
    };
    const txt = acc != null ? ` (±${acc} m)` : "";
    if (acc != null && acc > GOOD_ACCURACY_M) setGeoStatus("Locating…" + txt);
    else setGeoStatus("Location ready" + txt, "ok");
  }
  function onGeoErr(err) {
    const msg = err && err.code === 1
      ? "Location off, saving without it"
      : "Location unavailable, saving without it";
    setGeoStatus(msg, "warn");
  }
  function startGeolocation() {
    if (!("geolocation" in navigator)) { setGeoStatus("Location not supported on this device", "warn"); return; }
    setGeoStatus("Getting location…");
    try {
      geoWatchId = navigator.geolocation.watchPosition(onGeoOk, onGeoErr, {
        enableHighAccuracy: true, maximumAge: 0, timeout: 27000
      });
    } catch (_) { setGeoStatus("Location unavailable, saving without it", "warn"); }
  }

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
    receiptImage = ""; secondImage = ""; clearZoneFund(); signature = null; signatureIsDefault = false;
    renderAmount();
    document.querySelectorAll("#methodRow .seg").forEach((x) => x.setAttribute("aria-pressed", "false"));
    ["receiptPreview", "secondPreview"].forEach((id) => { $(id).innerHTML = ""; $(id).classList.add("hidden"); });
    $("secondReceiptField").classList.add("hidden");
    renderZoneFundPreview();
    renderSignaturePreview();
  }
  function wireSubmit() {
    $("txForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = validate();
      if (err) { toast(err, "err"); return; }
      if (!signature) {
        const d = findDefaultSignature($("beneficiary").value);
        if (d && d.sig) { signature = d.sig; signatureIsDefault = true; }
      }
      const tx = {
        mission, beneficiary: $("beneficiary").value.trim(),
        accountCode: selectedAccount, accountName: ACCOUNT_CODES[selectedAccount],
        description: $("description").value.trim(), amount: amountValue(),
        currency: CURRENCY, method, receiptImage,
        secondReceiptImage: SECOND_RECEIPT[method] ? secondImage : "",
        signature, location: lastPosition, zoneFund: zoneFund || null, zoneFundPdf: zoneFundPdf || "",
        clientCreatedAt: new Date().toISOString(), logged: false
      };
      const btn = $("submitBtn"); btn.disabled = true; btn.textContent = "Saving...";
      try { await postTransaction(tx); toast(`Saved to cloud (${titleCase(mission)})`, "ok"); }
      catch (_) { const ob = loadOutbox(); ob.push(tx); saveOutbox(ob); toast("Saved offline, will sync later", "ok"); }
      pushRecent(tx); renderRecent();
      pushHistory(tx);
      if (method === "wave") await saveWaveBalance(currentWave() - tx.amount);
      resetForm();
      btn.disabled = false; btn.textContent = "Save transaction";
    });
    $("syncBtn").addEventListener("click", () => syncOutbox(false));
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $("toast"); t.textContent = msg; t.className = "toast" + (kind ? " " + kind : "");
    if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // Dark mode follows the time of day: dark from 7pm to 6am, light otherwise.
  function isNightTime() { const h = new Date().getHours(); return h >= 19 || h < 6; }
  function applyAutoTheme() {
    const dark = isNightTime();
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0f1519" : "#2d3c45");
  }
  function wireTheme() {
    applyAutoTheme();
    setInterval(applyAutoTheme, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) applyAutoTheme(); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireTheme();
    wireAccountCombo();
    wireAmount();
    wireMethods();
    wireMission();
    wirePresets();
    wireRecent();
    wirePhoto([$("receiptCam"), $("receiptGal")], "receiptPreview", (v) => { receiptImage = v; });
    wirePhoto([$("secondCam"), $("secondGal")], "secondPreview", (v) => { secondImage = v; });
    wireZoneFund();
    wireSignature();
    wireSigLib();
    wireWave();
    wireSubmit();
    wireAutocomplete("beneficiary", "benAcPanel");
    wireAutocomplete("description", "descAcPanel");
    $("beneficiary").addEventListener("input", maybeApplyDefaultSignature);
    renderAmount();
    renderZoneFundPreview();
    renderSignaturePreview();
    setMission(currentMission());
    startGeolocation();
    if (apiBase()) syncOutbox(true);
  });
})();

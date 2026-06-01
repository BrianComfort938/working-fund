(function () {
  "use strict";

  // ---- account codes + series colors (KEEP EXACT codes) ----
  const ACCOUNT_CODES = {
    "00": "400-5102 Travel In-field", "01": "400-5700 Furnishings YM",
    "02": "400-5930 Food and Personal Items", "03": "400-5868 Utilities YM",
    "04": "400-5862 Rent YM", "05": "400-5920 Charitable Assistance",
    "06": "400-5221 Book of Mormon", "10": "000-5102 Travel Admin",
    "11": "000-5496 Luncheons, Socials & Hosting",
    "12": "000-5860 Small Purchases/Services for Mission Home & Office",
    "13": "000-5500 Miscellaneous", "14": "000-5370 Telephone and Internet",
    "15": "000-5221 Teaching Literature and Supplies",
    "16": "000-5200 Operating materials and supplies",
    "17": "000-5170 Vehicle Gasoline", "18": "000-5379 Postage and Mailing",
    "19": "000-5700 Small Office Equipment", "20": "000-5461 Bank Fees",
    "21": "000-5776 Small Office Equipment and Maintenance",
    "22": "000-5862 Rent Admin", "23": "000-5868 Utilities Admin",
    "30": "480-5862 Rent SM", "31": "480-5700 Furnishings SM",
    "32": "480-5868 Utilities SM", "40": "600-5480 Vehicle Taxes and Fees",
    "41": "600-5700 Vehicle Equipment", "42": "600-5772 Vehicle Maintenance and repairs",
    "50": "900-5102 Travel, Baggage, Visa and Other", "51": "900-5949 Missionary Medical",
  };
  const ACCOUNT_ORDER = Object.keys(ACCOUNT_CODES);
  const SERIES_META = {
    "400": { label: "Field", color: "#2e7d32" },
    "000": { label: "Admin", color: "#00618a" },
    "480": { label: "Senior", color: "#6a3d9a" },
    "600": { label: "Vehicle", color: "#e3811d" },
    "900": { label: "Travel / Medical", color: "#b3261e" },
  };
  const seriesColor = (name) => (SERIES_META[(name || "").slice(0, 3)] || {}).color || "#69757f";
  const groupDigits = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fmtAmount = (amt, cur) => {
    const n = Math.abs(parseInt(amt, 10) || 0);
    return (amt < 0 ? "-" : "") + groupDigits(n) + " " + (cur || "XOF");
  };
  const MISSIONS = ["east", "south"];
  const titleCase = (m) => (m === "south" ? "South" : "East");
  const METHOD_LABELS = { cash: "Cash", wave: "Wave", orange: "Orange Money" };
  const methodLabel = (m) => METHOD_LABELS[m] || m || "";

  // Browser-local history (this computer only), as the user requested.
  const HKEY_COMMITTED = "workingfund_review_committed";
  const HKEY_DELETED = "workingfund_review_deleted";
  const HIST_CAP = 50;

  const $ = (id) => document.getElementById(id);
  const state = {
    queue: [], idx: 0, period: "000", mission: "east", counts: { east: 0, south: 0 },
    cloud: false, calRef: null, view: "review",
  };

  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  const cur = () => state.queue[state.idx] || null;

  function toast(msg, kind) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (kind ? " " + kind : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), 2400);
    t.classList.remove("hidden");
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---- load / state ----
  async function load() {
    const s = await api("/api/state");
    state.period = s.period;
    state.cloud = s.cloud;
    state.counts = s.counts || { east: 0, south: 0 };
    $("period").value = s.period;
    const saved = localStorage.getItem("workingfund_mission");
    const wanted = MISSIONS.indexOf(saved) !== -1 ? saved : s.mission;
    if (wanted === s.mission) { state.mission = s.mission; state.queue = s.queue; }
    else {
      const res = await api("/api/mission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission: wanted }) });
      state.mission = res.mission; state.counts = res.counts || state.counts; state.queue = res.queue;
    }
    localStorage.setItem("workingfund_mission", state.mission);
    state.idx = 0; state.calRef = null;
    renderAll();
  }
  async function refreshState() {
    const res = await api("/api/mission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission: state.mission }) });
    state.counts = res.counts || state.counts;
    state.queue = res.queue;
    if (state.idx >= state.queue.length) state.idx = Math.max(0, state.queue.length - 1);
  }
  async function switchMission(m) {
    if (MISSIONS.indexOf(m) === -1 || m === state.mission) return;
    const res = await api("/api/mission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission: m }) });
    state.mission = res.mission; state.counts = res.counts || state.counts; state.queue = res.queue;
    localStorage.setItem("workingfund_mission", state.mission);
    state.idx = 0; state.calRef = null;
    renderAll();
    toast("Mission: " + titleCase(state.mission), "ok");
  }

  // ---- top-level render ----
  function renderAll() {
    $("cntEast").textContent = state.counts.east || 0;
    $("cntSouth").textContent = state.counts.south || 0;
    document.querySelectorAll(".mission-tab").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mission === state.mission)));
    $("progress").textContent = state.queue.length ? `${state.idx + 1} / ${state.queue.length}` : "0 / 0";

    const reviewing = state.view === "review";
    $("reviewView").classList.toggle("hidden", !reviewing);
    $("historyView").classList.toggle("hidden", reviewing);
    $("navGroup").style.visibility = reviewing ? "visible" : "hidden";
    $("historyBtn").textContent = reviewing ? "History" : "Review";
    if (reviewing) { renderReview(); renderCalendar(); }
    else renderHistory();
  }

  // ---- account select (grouped: code  name) ----
  function buildAccountOptions(selected) {
    const order = [], groups = {};
    ACCOUNT_ORDER.forEach((code) => {
      const k = ACCOUNT_CODES[code].slice(0, 3);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(code);
    });
    return order.map((k) => {
      const meta = SERIES_META[k] || { label: k };
      const opts = groups[k].map((code) =>
        `<option value="${code}" ${code === selected ? "selected" : ""}>${code}  ${esc(ACCOUNT_CODES[code])}</option>`).join("");
      return `<optgroup label="${k} - ${meta.label}">${opts}</optgroup>`;
    }).join("");
  }

  function fmtWhen(iso) {
    if (!iso) return "no date";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // ---- REVIEW view: editable-by-default form ----
  function renderReview() {
    const wrap = $("recForm");
    const t = cur();
    if (!t) {
      wrap.innerHTML = `<div class="done"><div class="big">&#10003;</div>
        <h2>No ${titleCase(state.mission)} transactions to review</h2>
        <p class="muted">Nothing left in this mission. Switch mission above, open History, or close this tab.</p></div>`;
      return;
    }
    const color = seriesColor(t.accountName);
    const neg = t.amount < 0;
    let media = "";
    if (t.hasReceipt) media += `<figure><figcaption>Receipt</figcaption><img src="/api/receipt/${t.id}/main"></figure>`;
    if (t.hasSecondReceipt) {
      const lbl = t.method === "orange" ? "Orange Money receipt" : "Wave receipt";
      media += `<figure><figcaption>${lbl}</figcaption><img src="/api/receipt/${t.id}/second"></figure>`;
    }
    if (t.hasSignature) media += `<figure><figcaption>Signature</figcaption><canvas class="sig-box" id="sigCv" width="230" height="86"></canvas></figure>`;
    if (!media) media = `<span class="none">No receipts or signature attached</span>`;

    wrap.innerHTML = `
      <div class="rec-field">
        <label>Beneficiary</label>
        <input id="f_ben" value="${esc(t.beneficiary)}" placeholder="Full name">
      </div>
      <div class="rec-grid">
        <div class="rec-field"><label>Mission</label>
          <select id="f_mission">${MISSIONS.map((m) => `<option value="${m}" ${m === t.mission ? "selected" : ""}>${titleCase(m)}</option>`).join("")}</select>
        </div>
        <div class="rec-field"><label>Method</label>
          <select id="f_method">${["cash", "wave", "orange"].map((m) => `<option value="${m}" ${m === t.method ? "selected" : ""}>${methodLabel(m)}</option>`).join("")}</select>
        </div>
      </div>
      <div class="rec-field">
        <label>Account</label>
        <select id="f_acc">${buildAccountOptions(t.accountCode)}</select>
        <span class="acct-hint"><span class="swatch" style="background:${color}"></span><span id="f_acctName">${esc(t.accountName)}</span></span>
      </div>
      <div class="rec-field">
        <label>Description</label>
        <textarea id="f_desc" rows="2" placeholder="Purpose of the expense">${esc(t.description)}</textarea>
      </div>
      <div class="rec-field">
        <label>Amount (${esc(t.currency)})</label>
        <div class="amount-row">
          <button type="button" id="f_sign" class="sign-btn ${neg ? "neg" : ""}">${neg ? "−" : "+"}</button>
          <input id="f_amt" inputmode="numeric" value="${groupDigits(Math.abs(t.amount))}">
        </div>
      </div>
      <div class="rec-field">
        <label>Recorded</label>
        <div class="rec-value">${fmtWhen(t.recordedAt)} &middot; <span class="mission-pill ${t.mission}">${titleCase(t.mission)}</span></div>
      </div>
      <div class="rec-field">
        <label>Attachments</label>
        <div class="receipts">${media}</div>
      </div>
      <div class="rec-actions">
        <button type="button" class="btn approve" id="actApprove">Approve &amp; print <kbd>Enter</kbd></button>
        <button type="button" class="btn skip" id="actSkip">Skip</button>
        <button type="button" class="btn delete" id="actDelete">Delete</button>
      </div>`;

    // live-bind edits into the in-memory transaction
    $("f_ben").addEventListener("input", (e) => { t.beneficiary = e.target.value; });
    $("f_mission").addEventListener("change", (e) => { t.mission = e.target.value; });
    $("f_method").addEventListener("change", (e) => { t.method = e.target.value; });
    $("f_desc").addEventListener("input", (e) => { t.description = e.target.value; });
    $("f_acc").addEventListener("change", (e) => {
      t.accountCode = e.target.value; t.accountName = ACCOUNT_CODES[t.accountCode] || "";
      $("f_acctName").textContent = t.accountName;
      document.querySelector(".acct-hint .swatch").style.background = seriesColor(t.accountName);
    });
    const amt = $("f_amt");
    amt.addEventListener("input", () => {
      const digits = amt.value.replace(/\D/g, "");
      amt.value = digits ? groupDigits(digits) : "";
      const mag = parseInt(digits, 10) || 0;
      t.amount = (t.amount < 0 ? -1 : 1) * mag;
    });
    $("f_sign").addEventListener("click", () => {
      t.amount = -t.amount;
      const isNeg = t.amount < 0;
      $("f_sign").classList.toggle("neg", isNeg);
      $("f_sign").textContent = isNeg ? "−" : "+";
    });
    $("actApprove").addEventListener("click", approve);
    $("actSkip").addEventListener("click", skip);
    $("actDelete").addEventListener("click", askDelete);

    if (t.hasSignature && t.signature) drawSignature($("sigCv"), t.signature, 6);
  }

  function drawSignature(canvas, sig, pad) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sig || !sig.s || !sig.s.length) return;
    pad = pad || 0;
    const scale = Math.min((canvas.width - 2 * pad) / sig.w, (canvas.height - 2 * pad) / sig.h);
    const ox = (canvas.width - sig.w * scale) / 2, oy = (canvas.height - sig.h * scale) / 2;
    ctx.lineWidth = Math.max(1.3, 2 * scale); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a2228";
    sig.s.forEach((flat) => {
      ctx.beginPath();
      for (let i = 0; i < flat.length; i += 2) { const x = ox + flat[i] * scale, y = oy + flat[i + 1] * scale; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    });
  }

  // ---- actions ----
  function snapshot(t) {
    return {
      id: t.id, mission: t.mission, beneficiary: t.beneficiary, accountCode: t.accountCode,
      accountName: t.accountName, description: t.description, amount: t.amount,
      currency: t.currency, method: t.method, recordedAt: t.recordedAt,
      signature: t.signature || null, at: new Date().toISOString(),
    };
  }
  function loadHist(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (_) { return []; } }
  function pushHist(key, snap) {
    const a = loadHist(key); a.unshift(snap); localStorage.setItem(key, JSON.stringify(a.slice(0, HIST_CAP)));
  }
  function editPayload(t) {
    return { beneficiary: t.beneficiary, mission: t.mission, accountCode: t.accountCode, accountName: t.accountName, description: t.description, amount: t.amount, method: t.method };
  }

  async function approve() {
    const t = cur();
    if (!t) return;
    try {
      const res = await api(`/api/approve/${t.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editPayload(t)) });
      window.open(`/print/${t.id}`, "_blank");
      if (res.rollover) { toast("CSV hit 100 lines - printing backup sheet", "ok"); window.open(`/print/csv-batch/${res.rollover}`, "_blank"); }
      else toast("Approved & printing", "ok");
      pushHist(HKEY_COMMITTED, snapshot(t));
      removeCurrent(true);
    } catch (e) { toast("Approve failed", "err"); }
  }

  function skip() {
    const t = cur();
    if (!t) return;
    // Stays on the cloud; just hidden for this session.
    removeCurrent(true);
    toast("Skipped (stays on cloud)", "ok");
  }

  let pendingDelete = null;
  function askDelete() {
    const t = cur();
    if (!t) return;
    pendingDelete = t.id;
    $("confirmMsg").textContent = `Delete the transaction for ${t.beneficiary || "(no beneficiary)"} (${fmtAmount(t.amount, t.currency)})?`;
    $("confirmModal").classList.remove("hidden");
  }
  async function doDelete() {
    const t = state.queue.find((x) => x.id === pendingDelete) || cur();
    $("confirmModal").classList.add("hidden");
    if (!t) return;
    try {
      await api(`/api/delete/${t.id}`, { method: "POST" });
      pushHist(HKEY_DELETED, snapshot(t));
      const i = state.queue.findIndex((x) => x.id === t.id);
      if (i >= 0) { state.idx = i; removeCurrent(true); }
      toast("Deleted from cloud", "ok");
    } catch (e) { toast("Delete failed", "err"); }
    pendingDelete = null;
  }

  function removeCurrent(decCount) {
    state.queue.splice(state.idx, 1);
    if (decCount && state.counts[state.mission] > 0) state.counts[state.mission] -= 1;
    if (state.idx >= state.queue.length) state.idx = Math.max(0, state.queue.length - 1);
    renderAll();
  }
  function move(delta) {
    if (!state.queue.length) return;
    state.idx = (state.idx + delta + state.queue.length) % state.queue.length;
    renderAll();
  }

  // ---- HISTORY view ----
  function renderHistory() {
    renderHistList(HKEY_COMMITTED, "committedList", "committed");
    renderHistList(HKEY_DELETED, "deletedList", "deleted");
  }
  function renderHistList(key, elId, status) {
    const el = $(elId);
    const items = loadHist(key);
    if (!items.length) { el.innerHTML = `<div class="hist-empty">Nothing yet.</div>`; return; }
    el.innerHTML = items.map((r, i) => {
      const neg = r.amount < 0;
      const amt = (neg ? "-" : "") + groupDigits(Math.abs(r.amount));
      const color = seriesColor(r.accountName || ACCOUNT_CODES[r.accountCode]);
      return `<div class="hist-row">` +
        `<span class="h-code" style="color:${color}">${esc(r.accountCode || "--")}</span>` +
        `<span class="h-main"><span class="h-who">${esc(r.beneficiary || "")}</span>` +
        `<span class="h-meta"><span class="mission-pill ${r.mission}">${titleCase(r.mission)}</span> ${fmtWhen(r.at)} &middot; ${methodLabel(r.method)}</span></span>` +
        `<span class="h-amt ${neg ? "neg" : ""}">${amt}</span>` +
        `<button type="button" class="btn" data-key="${key}" data-idx="${i}" data-status="${status}">Reverse</button>` +
        `</div>`;
    }).join("");
    el.querySelectorAll("[data-idx]").forEach((b) =>
      b.addEventListener("click", () => reverse(b.dataset.key, parseInt(b.dataset.idx, 10), b.dataset.status)));
  }
  async function reverse(key, idx, status) {
    const items = loadHist(key);
    const snap = items[idx];
    if (!snap) return;
    try {
      await api("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: snap.id, status, tx: snap }) });
      items.splice(idx, 1);
      localStorage.setItem(key, JSON.stringify(items));
      await refreshState();
      renderAll();
      toast(status === "committed" ? "Reversed - returned to review, local record undone" : "Reversed - returned to review", "ok");
    } catch (e) { toast("Reverse failed", "err"); }
  }

  // ---- calendar (marks days with transactions, the current tx day, and today) ----
  function renderCalendar() {
    const el = $("calendar");
    const t = cur();
    const counts = {};
    state.queue.forEach((x) => {
      const d = x.recordedAt ? new Date(x.recordedAt) : null;
      if (d && !isNaN(d)) counts[d.toDateString()] = (counts[d.toDateString()] || 0) + 1;
    });
    let ref = state.calRef;
    if (!ref) { const cd = t && t.recordedAt ? new Date(t.recordedAt) : new Date(); ref = isNaN(cd) ? new Date() : cd; }
    const year = ref.getFullYear(), month = ref.getMonth();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const lead = first.getDay();
    const title = first.toLocaleString(undefined, { month: "long", year: "numeric" });
    const curDS = t && t.recordedAt ? new Date(t.recordedAt).toDateString() : "";
    const todayDS = new Date().toDateString();

    let cells = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < lead; i++) cells += `<div class="day blank"></div>`;
    for (let d = 1; d <= days; d++) {
      const ds = new Date(year, month, d).toDateString();
      const cls = ["day"];
      if (counts[ds]) cls.push("has");
      if (ds === curDS) cls.push("current");
      if (ds === todayDS) cls.push("today");
      cells += `<div class="${cls.join(" ")}" ${counts[ds] ? `data-date="${ds}"` : ""}>${d}</div>`;
    }
    el.innerHTML = `
      <div class="cal-head">
        <button class="nav" id="cal_prev">&#8249;</button>
        <span class="cal-title">${title}</span>
        <button class="nav" id="cal_next">&#8250;</button>
      </div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend">
        <span><span class="k today"></span>Today</span>
        <span><span class="k current"></span>This transaction</span>
      </div>`;
    $("cal_prev").addEventListener("click", () => { state.calRef = new Date(year, month - 1, 1); renderCalendar(); });
    $("cal_next").addEventListener("click", () => { state.calRef = new Date(year, month + 1, 1); renderCalendar(); });
    el.querySelectorAll(".day.has").forEach((c) => c.addEventListener("click", () => jumpToDate(c.dataset.date)));
  }
  function jumpToDate(ds) {
    const i = state.queue.findIndex((x) => x.recordedAt && new Date(x.recordedAt).toDateString() === ds);
    if (i >= 0) { state.idx = i; state.calRef = null; renderAll(); }
  }
  function calMonth(delta) {
    const r = state.calRef || new Date();
    state.calRef = new Date(r.getFullYear(), r.getMonth() + delta, 1);
    renderCalendar();
  }

  // ---- period ----
  async function savePeriod() {
    try {
      const res = await api("/api/period", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: $("period").value }) });
      state.period = res.period; $("period").value = res.period; toast("Fund period " + res.period, "ok");
    } catch (e) { toast("Invalid period (000-999)", "err"); $("period").value = state.period; }
  }

  // ---- views ----
  function showHistory() { state.view = "history"; renderAll(); }
  function showReview() { state.view = "review"; renderAll(); }

  // ---- keyboard: Enter approves; arrows navigate; [ ] calendar. No E, no M. ----
  function onKey(e) {
    if (state.view !== "review") { if (e.key === "Escape") showReview(); return; }
    if (!$("confirmModal").classList.contains("hidden")) {
      if (e.key === "Enter") { e.preventDefault(); doDelete(); }
      else if (e.key === "Escape") { $("confirmModal").classList.add("hidden"); pendingDelete = null; }
      return;
    }
    const tag = e.target.tagName;
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
    if (e.key === "Enter") {
      if (tag === "TEXTAREA") return;       // newline in description
      e.preventDefault(); approve(); return;
    }
    if (inField) { if (e.key === "Escape") e.target.blur(); return; }
    switch (e.key) {
      case "ArrowRight": case " ": e.preventDefault(); move(1); break;
      case "ArrowLeft": move(-1); break;
      case "[": calMonth(-1); break;
      case "]": calMonth(1); break;
    }
  }

  // ---- init ----
  document.addEventListener("DOMContentLoaded", () => {
    $("period").addEventListener("change", savePeriod);
    $("period").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); savePeriod(); e.target.blur(); } });
    document.querySelectorAll(".mission-tab").forEach((b) => b.addEventListener("click", () => switchMission(b.dataset.mission)));
    $("prevBtn").addEventListener("click", () => move(-1));
    $("nextBtn").addEventListener("click", () => move(1));
    $("historyBtn").addEventListener("click", () => (state.view === "review" ? showHistory() : showReview()));
    $("backToReview").addEventListener("click", showReview);
    $("confirmCancel").addEventListener("click", () => { $("confirmModal").classList.add("hidden"); pendingDelete = null; });
    $("confirmOk").addEventListener("click", doDelete);
    document.addEventListener("keydown", onKey);
    load().catch(() => toast("Could not load transactions", "err"));
  });
})();

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
  const SERIES_META = {
    "400": { label: "YM / Field", color: "#22c55e" },
    "000": { label: "Admin", color: "#3b82f6" },
    "480": { label: "SM", color: "#a855f7" },
    "600": { label: "Vehicle", color: "#f59e0b" },
    "900": { label: "Travel & Medical", color: "#ef4444" },
  };
  const seriesColor = (name) => (SERIES_META[(name || "").slice(0, 3)] || {}).color || "#94a3b8";
  const groupDigits = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fmtAmount = (amt, cur) => {
    const n = Math.abs(parseInt(amt, 10) || 0);
    return (amt < 0 ? "-" : "") + groupDigits(n) + " " + (cur || "XOF");
  };
  const MISSIONS = ["east", "south"];
  const titleCase = (m) => (m === "south" ? "South" : "East");
  const METHOD_LABELS = { cash: "Cash", wave: "Wave", orange: "Orange Money" };
  const methodLabel = (m) => METHOD_LABELS[m] || m || "";

  const $ = (id) => document.getElementById(id);
  const state = {
    queue: [], idx: 0, period: "000", mission: "east", counts: { east: 0, south: 0 },
    cloud: false, editing: false, signNeg: false, calRef: null,
  };

  // ---- api ----
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

  // ---- load ----
  async function load() {
    const s = await api("/api/state");
    state.period = s.period;
    state.cloud = s.cloud;
    state.counts = s.counts || { east: 0, south: 0 };
    $("period").value = s.period;
    const mode = $("mode");
    mode.textContent = s.cloud ? "cloud" : "demo data";
    mode.className = "badge " + (s.cloud ? "cloud" : "demo");

    // Restore the reviewer's last mission from this browser (default = server's).
    const saved = localStorage.getItem("workingfund_mission");
    const wanted = MISSIONS.indexOf(saved) !== -1 ? saved : s.mission;
    await applyMission(wanted, s.mission, s.queue);
  }

  async function applyMission(wanted, serverMission, serverQueue) {
    if (wanted === serverMission && serverQueue) {
      state.mission = serverMission;
      state.queue = serverQueue;
    } else {
      const res = await api("/api/mission", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: wanted }),
      });
      state.mission = res.mission;
      state.counts = res.counts || state.counts;
      state.queue = res.queue;
    }
    localStorage.setItem("workingfund_mission", state.mission);
    state.idx = 0;
    state.editing = false;
    state.calRef = null;
    renderAll();
  }

  async function switchMission(m) {
    if (MISSIONS.indexOf(m) === -1 || m === state.mission) return;
    try {
      const res = await api("/api/mission", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: m }),
      });
      state.mission = res.mission;
      state.counts = res.counts || state.counts;
      state.queue = res.queue;
      localStorage.setItem("workingfund_mission", state.mission);
      state.idx = 0; state.editing = false; state.calRef = null;
      renderAll();
      toast("Mission: " + titleCase(state.mission), "ok");
    } catch (e) { toast("Could not switch mission", "err"); }
  }

  // ---- render ----
  function renderAll() {
    renderMission();
    renderProgress();
    if (state.editing) renderEditor(); else $("editor").classList.add("hidden");
    renderCard();
    renderCalendar();
  }

  function renderMission() {
    $("cntEast").textContent = state.counts.east || 0;
    $("cntSouth").textContent = state.counts.south || 0;
    document.querySelectorAll(".mission-tab").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mission === state.mission)));
  }

  function renderProgress() {
    $("progress").textContent = state.queue.length
      ? `${state.idx + 1} / ${state.queue.length}` : "0 / 0";
  }

  function fmtWhen(iso) {
    if (!iso) return "no date";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function renderCard() {
    const card = $("card");
    const t = cur();
    if (!t) {
      card.innerHTML = `<div class="done"><div class="big">&#10003;</div>
        <h2>No ${titleCase(state.mission)} transactions to review</h2>
        <p class="muted">Nothing left in this mission. Try the other mission (press <kbd>M</kbd>), or close this tab.</p></div>`;
      return;
    }
    const color = seriesColor(t.accountName);
    const neg = t.amount < 0;
    const secondLabel = t.method === "orange" ? "Orange Money receipt" : "Wave receipt";
    let receipts = "";
    if (t.hasReceipt || t.hasSecondReceipt || t.hasSignature) {
      receipts = `<div class="receipts">`;
      if (t.hasReceipt)
        receipts += `<figure><figcaption>Receipt</figcaption><img src="/api/receipt/${t.id}/main"></figure>`;
      if (t.hasSecondReceipt)
        receipts += `<figure><figcaption>${secondLabel}</figcaption><img src="/api/receipt/${t.id}/second"></figure>`;
      if (t.hasSignature)
        receipts += `<figure><figcaption>Signature</figcaption><canvas class="sig-box" data-sig="${t.id}" width="240" height="90"></canvas></figure>`;
      receipts += `</div>`;
    }
    card.innerHTML = `
      <div class="top">
        <div>
          <div class="who">${esc(t.beneficiary) || "(no beneficiary)"}</div>
          <div class="when">${fmtWhen(t.recordedAt)} &middot; <span class="mission-pill ${t.mission}">${titleCase(t.mission)}</span></div>
        </div>
        <div class="amount ${neg ? "neg" : ""}">${fmtAmount(t.amount, t.currency)}</div>
      </div>
      <div class="account-chip" style="border-left-color:${color}">
        <span class="swatch" style="background:${color}"></span>
        <span class="code">${esc(t.accountCode)}</span>
        <span>${esc(t.accountName)}</span>
      </div>
      <div class="desc">${esc(t.description) || "<span class='muted'>(no description)</span>"}</div>
      <span class="method ${t.method}">${esc(methodLabel(t.method)) || "-"}</span>
      ${receipts}
      <div class="actions">
        <button class="btn approve" data-act="approve">Approve &amp; print <kbd>A</kbd></button>
        <button class="btn ghost" data-act="edit">Edit <kbd>E</kbd></button>
        <button class="btn delete" data-act="delete">Delete <kbd>D</kbd></button>
      </div>`;
    card.querySelectorAll("[data-act]").forEach((b) =>
      b.addEventListener("click", () => doAction(b.dataset.act)));
    // Render any signature strokes onto their canvas (vector -> crisp, economical).
    card.querySelectorAll("canvas[data-sig]").forEach((cv) => {
      if (t.signature) drawSignature(cv, t.signature, 6);
    });
  }

  // Draw compact vector-stroke signature {w,h,s:[[x,y,...],...]} fit-to-canvas.
  function drawSignature(canvas, sig, pad) {
    const ctx = canvas.getContext("2d");
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (!sig || !sig.s || !sig.s.length) return;
    pad = pad || 0;
    const scale = Math.min((cw - 2 * pad) / sig.w, (ch - 2 * pad) / sig.h);
    const ox = (cw - sig.w * scale) / 2, oy = (ch - sig.h * scale) / 2;
    ctx.lineWidth = Math.max(1.3, 2 * scale);
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

  function buildAccountOptions(selected) {
    const order = [];
    const groups = {};
    Object.entries(ACCOUNT_CODES).forEach(([code, name]) => {
      const k = name.slice(0, 3);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push({ code, name });
    });
    return order.map((k) => {
      const meta = SERIES_META[k] || { label: k };
      const opts = groups[k].map(({ code, name }) =>
        `<option value="${code}" ${code === selected ? "selected" : ""}>${code} — ${esc(name)}</option>`).join("");
      return `<optgroup label="${k} · ${meta.label}">${opts}</optgroup>`;
    }).join("");
  }

  function renderEditor() {
    const t = cur();
    if (!t) { state.editing = false; $("editor").classList.add("hidden"); return; }
    state.signNeg = t.amount < 0;
    const ed = $("editor");
    ed.classList.remove("hidden");
    ed.innerHTML = `
      <div class="field"><label>Beneficiary</label>
        <input id="e_ben" value="${esc(t.beneficiary)}"></div>
      <div class="field"><label>Mission</label>
        <select id="e_mission">
          ${MISSIONS.map((m) => `<option value="${m}" ${m === t.mission ? "selected" : ""}>${titleCase(m)}</option>`).join("")}
        </select></div>
      <div class="field"><label>Account</label>
        <select id="e_acc">${buildAccountOptions(t.accountCode)}</select></div>
      <div class="field"><label>Description</label>
        <textarea id="e_desc" rows="2">${esc(t.description)}</textarea></div>
      <div class="field"><label>Amount (${esc(t.currency)})</label>
        <div class="amount-row">
          <button type="button" id="e_sign" class="sign-btn ${state.signNeg ? "neg" : ""}">${state.signNeg ? "−" : "+"}</button>
          <input id="e_amt" inputmode="numeric" value="${Math.abs(t.amount)}"></div></div>
      <div class="field"><label>Method</label>
        <select id="e_method">
          ${["cash", "wave", "orange"].map((m) => `<option value="${m}" ${m === t.method ? "selected" : ""}>${methodLabel(m)}</option>`).join("")}
        </select></div>
      <div class="actions">
        <button class="btn primary" id="e_save">Save <kbd>Enter</kbd></button>
        <button class="btn ghost" id="e_cancel">Cancel <kbd>Esc</kbd></button>
      </div>`;
    $("e_sign").addEventListener("click", () => {
      state.signNeg = !state.signNeg;
      $("e_sign").textContent = state.signNeg ? "−" : "+";
      $("e_sign").classList.toggle("neg", state.signNeg);
    });
    $("e_save").addEventListener("click", saveEdit);
    $("e_cancel").addEventListener("click", cancelEdit);
    $("e_amt").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); });
    $("e_ben").focus();
  }

  async function saveEdit() {
    const t = cur();
    if (!t) return;
    const digits = ($("e_amt").value || "").replace(/\D/g, "");
    const amount = (state.signNeg ? -1 : 1) * (parseInt(digits, 10) || 0);
    const code = $("e_acc").value;
    const newMission = $("e_mission").value;
    const payload = {
      beneficiary: $("e_ben").value.trim(),
      mission: newMission,
      accountCode: code,
      accountName: ACCOUNT_CODES[code] || t.accountName,
      description: $("e_desc").value.trim(),
      amount,
      method: $("e_method").value,
    };
    try {
      await api(`/api/edit/${t.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.editing = false;
      // Editing the mission can move a transaction out of the current view, so
      // re-pull the filtered queue + counts.
      const res = await api("/api/mission", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: state.mission }),
      });
      state.counts = res.counts || state.counts;
      state.queue = res.queue;
      if (state.idx >= state.queue.length) state.idx = Math.max(0, state.queue.length - 1);
      renderAll();
      toast("Saved", "ok");
    } catch (e) { toast("Save failed", "err"); }
  }

  function cancelEdit() { state.editing = false; renderAll(); }

  async function doAction(act) {
    const t = cur();
    if (!t) return;
    if (act === "edit") { state.editing = true; renderEditor(); return; }
    if (act === "delete") {
      if (!confirm(`Delete this transaction for ${t.beneficiary}? This cannot be undone.`)) return;
      try {
        await api(`/api/delete/${t.id}`, { method: "POST" });
        removeCurrent();
        toast("Deleted", "ok");
      } catch (e) { toast("Delete failed", "err"); }
      return;
    }
    if (act === "approve") {
      try {
        const res = await api(`/api/approve/${t.id}`, { method: "POST" });
        window.open(`/print/${t.id}`, "_blank");
        if (res.rollover) {
          toast("CSV hit 100 lines — printing backup sheet", "ok");
          window.open(`/print/csv-batch/${res.rollover}`, "_blank");
        } else {
          toast("Approved & printing", "ok");
        }
        removeCurrent();
      } catch (e) { toast("Approve failed", "err"); }
    }
  }

  function removeCurrent() {
    if (state.counts[state.mission] > 0) state.counts[state.mission] -= 1;
    state.queue.splice(state.idx, 1);
    if (state.idx >= state.queue.length) state.idx = Math.max(0, state.queue.length - 1);
    state.editing = false;
    renderAll();
  }

  function move(delta) {
    if (!state.queue.length) return;
    state.idx = (state.idx + delta + state.queue.length) % state.queue.length;
    state.editing = false;
    renderAll();
  }

  // ---- calendar ----
  function renderCalendar() {
    const el = $("calendar");
    const t = cur();
    const counts = {};
    state.queue.forEach((x) => {
      const d = x.recordedAt ? new Date(x.recordedAt) : null;
      if (d && !isNaN(d)) counts[d.toDateString()] = (counts[d.toDateString()] || 0) + 1;
    });
    let ref = state.calRef;
    if (!ref) {
      const cd = t && t.recordedAt ? new Date(t.recordedAt) : new Date();
      ref = isNaN(cd) ? new Date() : cd;
    }
    const year = ref.getFullYear(), month = ref.getMonth();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const lead = first.getDay();
    const title = first.toLocaleString(undefined, { month: "long", year: "numeric" });
    const curDateStr = t && t.recordedAt ? new Date(t.recordedAt).toDateString() : "";

    let cells = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < lead; i++) cells += `<div class="day blank"></div>`;
    for (let d = 1; d <= days; d++) {
      const ds = new Date(year, month, d).toDateString();
      const has = counts[ds];
      const isCur = ds === curDateStr;
      cells += `<div class="day ${has ? "has" : ""} ${isCur ? "current" : ""}" ${has ? `data-date="${ds}"` : ""}>${d}</div>`;
    }
    el.innerHTML = `
      <div class="cal-head">
        <button class="nav" id="cal_prev">‹</button>
        <span class="cal-title">${title}</span>
        <button class="nav" id="cal_next">›</button>
      </div>
      <div class="cal-grid">${cells}</div>`;
    $("cal_prev").addEventListener("click", () => { state.calRef = new Date(year, month - 1, 1); renderCalendar(); });
    $("cal_next").addEventListener("click", () => { state.calRef = new Date(year, month + 1, 1); renderCalendar(); });
    el.querySelectorAll(".day.has").forEach((c) =>
      c.addEventListener("click", () => jumpToDate(c.dataset.date)));
  }

  function jumpToDate(ds) {
    const i = state.queue.findIndex((x) => x.recordedAt && new Date(x.recordedAt).toDateString() === ds);
    if (i >= 0) { state.idx = i; state.editing = false; state.calRef = null; renderAll(); }
  }

  // ---- period ----
  async function savePeriod() {
    try {
      const res = await api("/api/period", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: $("period").value }),
      });
      state.period = res.period;
      $("period").value = res.period;
      toast("Fund period " + res.period, "ok");
    } catch (e) { toast("Invalid period (000–999)", "err"); $("period").value = state.period; }
  }

  // ---- keyboard ----
  function onKey(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (state.editing) {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); saveEdit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
      return;
    }
    if (inField) {
      if (e.key === "Enter" && e.target.id === "period") { e.preventDefault(); savePeriod(); e.target.blur(); }
      return;
    }
    switch (e.key.toLowerCase()) {
      case "a": doAction("approve"); break;
      case "e": doAction("edit"); break;
      case "d": doAction("delete"); break;
      case "m": switchMission(state.mission === "east" ? "south" : "east"); break;
      case "arrowright": case " ": e.preventDefault(); move(1); break;
      case "arrowleft": move(-1); break;
      case "[": { const r = state.calRef || new Date(); state.calRef = new Date(r.getFullYear(), r.getMonth() - 1, 1); renderCalendar(); break; }
      case "]": { const r = state.calRef || new Date(); state.calRef = new Date(r.getFullYear(), r.getMonth() + 1, 1); renderCalendar(); break; }
      case "p": e.preventDefault(); $("period").focus(); $("period").select(); break;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---- init ----
  document.addEventListener("DOMContentLoaded", () => {
    $("period").addEventListener("change", savePeriod);
    document.querySelectorAll(".mission-tab").forEach((b) =>
      b.addEventListener("click", () => switchMission(b.dataset.mission)));
    document.addEventListener("keydown", onKey);
    load().catch(() => toast("Could not load transactions", "err"));
  });
})();

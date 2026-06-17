(function () {
  "use strict";

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
  const ACCOUNT_ORDER = Object.keys(ACCOUNT_CODES).sort();
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
  // Toggle the "darker, empty" look on a field whose value is blank, so every
  // field stays present in the form even when there is nothing to show.
  function markEmpty(el, empty) { if (el) el.classList.toggle("is-empty", !!empty); }

  async function load() {
    const s = await api("/api/state");
    state.period = s.period;
    state.cloud = s.cloud;
    state.counts = s.counts || { east: 0, south: 0 };
    $("period").value = s.period;
    // The server keeps the fund period only in memory (it resets to 000 when the
    // review app restarts), so persist it in this browser and push the saved
    // value back on load — same approach as the mission below.
    const savedPeriod = localStorage.getItem("workingfund_period");
    if (savedPeriod && savedPeriod !== s.period) {
      try {
        const pr = await api("/api/period", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: savedPeriod }) });
        state.period = pr.period; $("period").value = pr.period;
      } catch (_) {}
    }
    localStorage.setItem("workingfund_period", state.period);
    const saved = localStorage.getItem("workingfund_mission");
    let wanted = MISSIONS.indexOf(saved) !== -1 ? saved : s.mission;
    if (!state.counts[wanted] && state.counts[wanted === "east" ? "south" : "east"]) {
      wanted = wanted === "east" ? "south" : "east";
    }
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

  function renderAll() {
    $("cntEast").textContent = state.counts.east || 0;
    $("cntSouth").textContent = state.counts.south || 0;
    document.querySelectorAll(".mission-tab").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mission === state.mission)));
    $("progress").textContent = state.queue.length ? `${state.idx + 1} / ${state.queue.length}` : "0 / 0";

    const mb = $("missionBadge");
    if (mb) { mb.textContent = titleCase(state.mission); mb.className = "mission-pill " + state.mission; }
    const pb = $("periodBadge");
    if (pb) pb.textContent = "WF " + state.period;
    $("historyBtn").textContent = state.view === "review" ? "History" : "Review";

    const reviewing = state.view === "review";
    $("reviewView").classList.toggle("hidden", !reviewing);
    $("historyView").classList.toggle("hidden", reviewing);
    if (reviewing) { renderReview(); renderCalendar(); renderLocation(); renderTimeBanner(); loadFund(); }
    else renderHistory();
  }

  const DAY_MIN = 24 * 60;
  const TL_MARKS = [
    { min: 6 * 60 + 30, label: "6:30" },
    { min: 9 * 60, label: "9:00" },
    { min: 12 * 60, label: "12:00" },
    { min: 18 * 60 + 30, label: "18:30" },
    { min: 22 * 60 + 30, label: "22:30" },
  ];
  const CLUSTER_GAP_PX = 30;
  let tlDrag = null;
  const txMinutes = (t) => {
    const d = t && t.recordedAt ? new Date(t.recordedAt) : null;
    if (!d || isNaN(d)) return null;
    return d.getHours() * 60 + d.getMinutes();
  };
  const hhmm = (mins) => String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  function clip(text, words) {
    const w = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "";
    return w.length > words ? w.slice(0, words).join(" ") + "…" : w.join(" ");
  }
  function sentenceCase(text) {
    const s = String(text || "").trim();
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  function renderTimeBanner() {
    const el = $("timeBanner");
    if (!el) return;
    const t = cur();

    const refD = t && t.recordedAt && !isNaN(new Date(t.recordedAt)) ? new Date(t.recordedAt) : new Date();
    const dayKey = refD.toDateString();

    const dayTx = state.queue
      .map((x, i) => ({ x, i, mins: txMinutes(x) }))
      .filter((o) => o.mins != null && new Date(o.x.recordedAt).toDateString() === dayKey)
      .sort((a, b) => a.mins - b.mins);

    const recordedLabel = t && t.recordedAt ? fmtWhen(t.recordedAt) : "No date";
    const header = `<div class="tl-head"><span class="tl-recorded">${esc(recordedLabel)}</span>` +
      `<span class="tl-sub">${dayTx.length} transaction${dayTx.length === 1 ? "" : "s"}</span></div>`;

    const marks = TL_MARKS.map((m) => {
      const pct = (m.min / DAY_MIN) * 100;
      return `<div class="tl-mark" style="top:${pct}%"><span class="tl-tick"></span>` +
        `<span class="tl-label">${m.label}</span></div>`;
    }).join("");

    el.innerHTML = header + `<div class="tl-rail" id="tlRail"><div class="tl-line"></div>${marks}</div>`;
    const rail = $("tlRail");
    const railH = rail.clientHeight || 360;

    const clusters = [];
    dayTx.forEach((o) => {
      const px = (o.mins / DAY_MIN) * railH;
      const last = clusters[clusters.length - 1];
      if (last && px - last.lastPx < CLUSTER_GAP_PX) { last.items.push(o); last.lastPx = px; }
      else clusters.push({ items: [o], lastPx: px });
    });

    rail.insertAdjacentHTML("beforeend", clusters.map((c, ci) =>
      c.items.length === 1 ? singleMarkerHtml(c.items[0]) : clusterMarkerHtml(c, ci)).join(""));

    wireTimeline(rail, clusters);
  }

  function singleMarkerHtml(o) {
    const pct = (o.mins / DAY_MIN) * 100;
    const isCur = o.i === state.idx;
    const name = sentenceCase(clip(o.x.beneficiary, 4)) || "(no name)";
    const desc = sentenceCase(clip(o.x.description, 6));
    return `<div class="tl-tx${isCur ? " current" : ""}" style="top:${pct}%" data-idx="${o.i}" title="${esc(hhmm(o.mins))}, ${esc(o.x.beneficiary || "")}">` +
      `<span class="tl-box"><span class="tl-box-name">${esc(name)}</span>` +
      (desc ? `<span class="tl-box-desc">${esc(desc)}</span>` : "") + `</span>` +
      `<span class="tl-txdot"></span></div>`;
  }

  function clusterPos(items) {
    const p = items.findIndex((o) => o.i === state.idx);
    return p >= 0 ? p : 0;
  }

  function clusterMarkerHtml(c, ci) {
    const items = c.items;
    const meanMin = items.reduce((s, o) => s + o.mins, 0) / items.length;
    const pct = (meanMin / DAY_MIN) * 100;
    const active = items.some((o) => o.i === state.idx);
    const pos = clusterPos(items);
    const o = items[pos];
    const name = sentenceCase(clip(o.x.beneficiary, 4)) || "(no name)";
    const desc = sentenceCase(clip(o.x.description, 6));
    const t0 = hhmm(items[0].mins), t1 = hhmm(items[items.length - 1].mins);
    const range = t0 === t1 ? t0 : t0 + " to " + t1;
    return `<div class="tl-cluster${active ? " current" : ""}" style="top:${pct}%" data-cluster="${ci}" ` +
      `title="${esc(range)}, ${items.length} transactions at about the same time">` +
      `<span class="tl-box">` +
        `<span class="tl-box-head"><span class="tl-box-time">${esc(hhmm(o.mins))}</span>` +
        `<span class="tl-count">${pos + 1} / ${items.length}</span></span>` +
        `<span class="tl-box-name">${esc(name)}</span>` +
        (desc ? `<span class="tl-box-desc">${esc(desc)}</span>` : "") +
      `</span>` +
      `<span class="tl-txdot cluster"><span class="tl-badge">${items.length}</span></span></div>`;
  }

  function updateClusterNode(node, items, pos) {
    const o = items[pos];
    node.classList.add("current");
    node.querySelector(".tl-box-time").textContent = hhmm(o.mins);
    node.querySelector(".tl-count").textContent = (pos + 1) + " / " + items.length;
    node.querySelector(".tl-box-name").textContent = sentenceCase(clip(o.x.beneficiary, 4)) || "(no name)";
    const d = node.querySelector(".tl-box-desc");
    if (d) d.textContent = sentenceCase(clip(o.x.description, 6));
  }

  function cascadeLight(i) {
    state.idx = i;
    $("progress").textContent = state.queue.length ? `${state.idx + 1} / ${state.queue.length}` : "0 / 0";
    const t = cur();
    const rl = document.querySelector("#timeBanner .tl-recorded");
    if (rl) rl.textContent = t && t.recordedAt ? fmtWhen(t.recordedAt) : "No date";
    renderReview();
    renderLocation();
  }

  function wireTimeline(rail, clusters) {
    rail.querySelectorAll(".tl-tx").forEach((node) =>
      node.addEventListener("click", () => {
        const i = parseInt(node.dataset.idx, 10);
        if (!isNaN(i)) { state.idx = i; renderAll(); }
      }));

    rail.querySelectorAll(".tl-cluster").forEach((node) => {
      const items = clusters[parseInt(node.dataset.cluster, 10)].items;
      const n = items.length;
      const step = (delta) => {
        const here = items.some((o) => o.i === state.idx);
        const np = here ? (((clusterPos(items) + delta) % n) + n) % n : 0;
        state.idx = items[np].i;
        renderAll();
      };

      node.addEventListener("wheel", (e) => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });

      node.addEventListener("pointerdown", (e) => {
        tlDrag = { node, items, startY: e.clientY, startPos: clusterPos(items), lastP: clusterPos(items), moved: false };
        try { node.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });
      node.addEventListener("pointermove", (e) => {
        if (!tlDrag || tlDrag.node !== node) return;
        const dy = e.clientY - tlDrag.startY;
        if (Math.abs(dy) > 3) tlDrag.moved = true;
        let p = tlDrag.startPos + Math.round(dy / 22);
        p = Math.max(0, Math.min(n - 1, p));
        if (p !== tlDrag.lastP) { tlDrag.lastP = p; cascadeLight(items[p].i); updateClusterNode(node, items, p); }
      });
      const endDrag = (e) => {
        if (!tlDrag || tlDrag.node !== node) return;
        const moved = tlDrag.moved;
        tlDrag = null;
        try { node.releasePointerCapture(e.pointerId); } catch (_) {}
        if (moved) renderAll();
        else step(1);
      };
      node.addEventListener("pointerup", endDrag);
      node.addEventListener("pointercancel", endDrag);
    });
  }

  function renderLocation() {
    const mapEl = $("locMap"), metaEl = $("locMeta");
    if (!mapEl) return;
    const t = cur();
    const loc = t && t.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lon !== "number") {
      mapEl.innerHTML = `<div class="loc-empty">No location captured</div>`;
      metaEl.textContent = "";
      return;
    }
    const d = 0.004;
    const bbox = [loc.lon - d, loc.lat - d, loc.lon + d, loc.lat + d].join("%2C");
    const marker = `${loc.lat}%2C${loc.lon}`;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
    if (mapEl.dataset.marker !== marker) {
      mapEl.dataset.marker = marker;
      mapEl.innerHTML = `<iframe title="Transaction location" src="${src}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    }
    const acc = loc.accuracy != null ? ` &middot; ±${loc.accuracy} m` : "";
    const ll = `${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}`;
    metaEl.innerHTML = `<a href="https://www.google.com/maps?q=${loc.lat},${loc.lon}" target="_blank" rel="noopener">${esc(ll)}</a>${acc}`;
  }

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
      return `<optgroup label="${k}: ${meta.label}">${opts}</optgroup>`;
    }).join("");
  }

  function fmtWhen(iso) {
    if (!iso) return "no date";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fmtShortDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function receiptFigure(t, which, caption) {
    const off = !!(t.excluded && t.excluded[which]);
    const src = `/api/receipt/${t.id}/${which}`;
    return `<figure class="receipt-fig${off ? " excluded" : ""}" data-which="${which}">` +
      `<figcaption>${esc(caption)}</figcaption>` +
      `<div class="receipt-img-wrap" title="Hover to enlarge">` +
        `<img class="receipt-thumb" src="${src}" alt="${esc(caption)}">` +
        `<img class="receipt-zoom" src="${src}" alt="" aria-hidden="true">` +
        `<span class="excluded-tag">Won't print</span>` +
      `</div>` +
      `<button type="button" class="receipt-toggle" data-which="${which}">` +
        `${off ? "Add back to print" : "Remove from print"}</button>` +
      `</figure>`;
  }

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
    if (t.hasReceipt) media += receiptFigure(t, "main", "Receipt");
    if (t.hasSecondReceipt) {
      media += receiptFigure(t, "second", t.method === "orange" ? "Orange Money receipt" : "Wave receipt");
    }
    if (t.hasSignature) media += `<figure class="receipt-fig sig-fig"><figcaption>Signature</figcaption><canvas class="sig-box" id="sigCv" width="230" height="86"></canvas></figure>`;
    const hasMedia = !!media;
    if (!media) media = `<div class="receipts-empty">No receipts or signature attached</div>`;

    // Keep the beneficiary and description exactly as submitted from the portal.
    // (The compact timeline cards still sentence-case for a tidy glance, but the
    // editable fields and the saved record must preserve the original casing.)

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
        <label>Attachments</label>
        <div class="receipts${hasMedia ? "" : " is-empty"}">${media}</div>
      </div>
      <div class="rec-actions">
        <button type="button" class="btn approve" id="actApprove">Approve &amp; print</button>
        <button type="button" class="btn approve-noprint" id="actApproveNoPrint" title="Record without printing (Shift+Enter)">Approve, no print</button>
        <button type="button" class="btn skip" id="actSkip">Skip</button>
        <button type="button" class="btn delete" id="actDelete">Delete</button>
      </div>`;

    $("f_ben").addEventListener("input", (e) => { t.beneficiary = e.target.value; markEmpty(e.target, !e.target.value.trim()); });
    $("f_mission").addEventListener("change", (e) => { t.mission = e.target.value; });
    $("f_method").addEventListener("change", (e) => { t.method = e.target.value; });
    $("f_desc").addEventListener("input", (e) => { t.description = e.target.value; markEmpty(e.target, !e.target.value.trim()); });
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
      markEmpty(amt, !amt.value.trim());
    });
    $("f_sign").addEventListener("click", () => {
      t.amount = -t.amount;
      const isNeg = t.amount < 0;
      $("f_sign").classList.toggle("neg", isNeg);
      $("f_sign").textContent = isNeg ? "−" : "+";
    });
    markEmpty($("f_ben"), !String(t.beneficiary || "").trim());
    markEmpty($("f_desc"), !String(t.description || "").trim());
    markEmpty($("f_amt"), !$("f_amt").value.trim());
    $("actApprove").addEventListener("click", () => approve());
    $("actApproveNoPrint").addEventListener("click", () => approve({ noPrint: true }));
    $("actSkip").addEventListener("click", skip);
    $("actDelete").addEventListener("click", askDelete);

    wrap.querySelectorAll(".receipt-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const which = btn.dataset.which;
        t.excluded = t.excluded || {};
        t.excluded[which] = !t.excluded[which];
        const off = t.excluded[which];
        btn.textContent = off ? "Add back to print" : "Remove from print";
        const fig = btn.closest(".receipt-fig");
        if (fig) fig.classList.toggle("excluded", off);
        toast(off ? "Removed from printed record" : "Added back to printed record");
      });
    });

    if (t.hasSignature && t.signature) drawSignature($("sigCv"), t.signature, 6);

    loadSimilar(t);
  }

  async function loadSimilar(t) {
    const field = $("similarField"), list = $("similarList");
    if (!field || !list || !t) return;
    const forId = t.id;
    let matches = [];
    try { matches = (await api(`/api/similar/${t.id}`)).matches || []; }
    catch (_) { matches = []; }
    if (!cur() || cur().id !== forId) return;
    if (!matches.length) { list.innerHTML = `<div class="dup-empty">None found</div>`; return; }
    list.innerHTML = matches.map((m) => {
      const neg = m.amount < 0;
      const amt = (neg ? "-" : "") + groupDigits(Math.abs(m.amount)) + " " + (m.currency || "XOF");
      const when = m.recorded_at ? fmtShortDate(m.recorded_at) : "";
      const meta = [when, methodLabel(m.method)].filter(Boolean).join(" · ");
      return `<div class="similar-row">` +
        `<span class="s-who">${esc(sentenceCase(m.beneficiary))}</span>` +
        `<span class="s-amt">${esc(amt)}</span>` +
        (meta ? `<span class="s-meta">${esc(meta)}</span>` : "") + `</div>`;
    }).join("");
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

  async function approve(opts) {
    const noPrint = !!(opts && opts.noPrint);
    const t = cur();
    if (!t) return;
    const excludeReceipts = t.excluded ? Object.keys(t.excluded).filter((k) => t.excluded[k]) : [];
    try {
      const res = await api(`/api/approve/${t.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, editPayload(t), { excludeReceipts, noPrint })) });
      if (!noPrint && !res.printed) window.open(`/print/${t.id}`, "_blank");
      if (res.rollover) { toast("CSV hit 100 lines, printing backup sheet", "ok"); window.open(`/print/csv-batch/${res.rollover}`, "_blank"); }
      else toast(noPrint ? "Approved, not printed" : (res.printed ? "Approved & printed" : "Approved & printing"), "ok");
      pushHist(HKEY_COMMITTED, snapshot(t));
      removeCurrent(true);
    } catch (e) { toast("Approve failed", "err"); }
  }

  function skip() {
    const t = cur();
    if (!t) return;
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
      toast(status === "committed" ? "Reversed. Returned to review, local record undone" : "Reversed. Returned to review", "ok");
    } catch (e) { toast("Reverse failed", "err"); }
  }

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

  async function savePeriod() {
    try {
      const res = await api("/api/period", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: $("period").value }) });
      state.period = res.period; $("period").value = res.period;
      localStorage.setItem("workingfund_period", res.period);
      const pb = $("periodBadge"); if (pb) pb.textContent = "WF " + res.period;
      toast("Fund period " + res.period, "ok");
      loadFund();
    } catch (e) { toast("Invalid period (000-999)", "err"); $("period").value = state.period; }
  }

  function dashboardUrl() {
    return "/dashboard?mission=" + encodeURIComponent(state.mission) + "&period=" + encodeURIComponent(state.period);
  }
  function renderFund(f) {
    const box = $("fundBox");
    if (!box) return;
    const neg = f.remaining < 0;
    box.classList.remove("hidden");
    box.innerHTML =
      `<span class="fund-top"><span class="fund-label">Working fund</span>` +
      `<span class="fund-mode">${f.mode === "all" ? "+ in review" : "recorded"}</span></span>` +
      `<span class="fund-remaining ${neg ? "neg" : ""}">${groupDigits(Math.abs(f.remaining))}` +
      `<span class="fund-cur">XOF${neg ? " over" : ""}</span></span>` +
      `<span class="fund-detail"><span>Start <b>${groupDigits(f.start)}</b></span>` +
      `<span>Spent <b>${groupDigits(f.spent)}</b></span></span>` +
      `<span class="fund-foot">${f.recordedCount} recorded` +
      `${f.mode === "all" && f.pendingCount ? " &middot; " + f.pendingCount + " in review" : ""} &middot; tap to open</span>`;
  }
  async function loadFund() {
    try {
      renderFund(await api(`/api/fund?mission=${encodeURIComponent(state.mission)}&period=${encodeURIComponent(state.period)}`));
    } catch (_) {}
  }

  function showHistory() { state.view = "history"; renderAll(); }
  function showReview() { state.view = "review"; renderAll(); }

  function openSettings() { $("settingsModal").classList.remove("hidden"); loadSettings(); }
  function closeSettings() { $("settingsModal").classList.add("hidden"); }

  function setMyStatus(msg, kind) {
    const el = $("myStatus");
    el.textContent = msg || "";
    el.className = "set-status" + (kind ? " " + kind : "");
  }
  function mysqlPayload() {
    return {
      MYSQL_ENABLED: $("myEnabled").checked,
      MYSQL_HOST: $("myHost").value.trim(),
      MYSQL_PORT: $("myPort").value.trim(),
      MYSQL_DB: $("myDb").value.trim(),
      MYSQL_USER: $("myUser").value.trim(),
      MYSQL_TABLE: $("myTable").value.trim(),
      MYSQL_PASSWORD: $("myPassword").value, // blank means "leave unchanged"
    };
  }
  function applyMysql(m) {
    $("myEnabled").checked = !!m.MYSQL_ENABLED;
    $("myHost").value = m.MYSQL_HOST || "";
    $("myPort").value = m.MYSQL_PORT || "";
    $("myDb").value = m.MYSQL_DB || "";
    $("myUser").value = m.MYSQL_USER || "";
    $("myTable").value = m.MYSQL_TABLE || "";
    $("myPassword").value = "";
    $("myPassword").placeholder = m.passwordSet ? "•••••• unchanged" : "(none set)";
  }
  async function loadSettings() {
    try {
      const s = await api("/api/settings");
      applyMysql(s.mysql || {});
      if (s.mysqlDriver === false) setMyStatus("pymysql isn't installed on this computer, so the MySQL mirror is off. Run: pip install -r requirements.txt", "err");
      else setMyStatus("");
    } catch (_) { setMyStatus("Could not load settings.", "err"); }
    try {
      const f = await api(`/api/fund?mission=${encodeURIComponent(state.mission)}&period=${encodeURIComponent(state.period)}`);
      $("fundStart").value = f.start ? String(f.start) : "";
      $("balRecorded").checked = f.mode !== "all";
      $("balAll").checked = f.mode === "all";
      setFundStatus("");
    } catch (_) { setFundStatus("Could not load the working fund.", "err"); }
  }
  function setFundStatus(msg, kind) {
    const el = $("fundStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "set-status" + (kind ? " " + kind : "");
  }
  async function saveFund() {
    const start = parseInt(($("fundStart").value || "").replace(/\D/g, ""), 10);
    const mode = $("balAll").checked ? "all" : "recorded";
    try {
      await api("/api/fund", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: state.mission, period: state.period, start: isNaN(start) ? 0 : start, mode }) });
      setFundStatus("Saved.", "ok");
      toast("Working fund saved", "ok");
      loadFund();
    } catch (e) { setFundStatus("Could not save.", "err"); toast("Save failed", "err"); }
  }
  async function saveMysql() {
    try {
      const res = await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mysql: mysqlPayload() }) });
      applyMysql(res.mysql || {});
      setMyStatus("Saved.", "ok");
      toast("MySQL settings saved", "ok");
    } catch (e) {
      setMyStatus("Could not save. Table name may use only letters, numbers, and underscores.", "err");
      toast("Save failed", "err");
    }
  }
  async function testMysql() {
    setMyStatus("Testing connection…", "");
    try {
      const res = await api("/api/settings/test-mysql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mysql: mysqlPayload() }) });
      setMyStatus(res.message || (res.ok ? "Connected." : "Could not connect."), res.ok ? "ok" : "err");
    } catch (e) { setMyStatus("Test failed (server error).", "err"); }
  }

  // Excel-style key tips. Press Alt to paint a key hint over every control in the
  // review view; press the shown key to use that control. Each entry resolves its
  // element live, because the form is re-rendered for every transaction.
  const KEYTIPS = [
    { code: "b", label: "B", el: () => $("f_ben") },
    { code: "m", label: "M", el: () => $("f_mission") },
    { code: "e", label: "E", el: () => $("f_method") },
    { code: "a", label: "A", el: () => $("f_acc") },
    { code: "d", label: "D", el: () => $("f_desc") },
    { code: "s", label: "S", el: () => $("f_sign") },
    { code: "n", label: "N", el: () => $("f_amt") },
    { code: "r", label: "R", el: () => document.querySelectorAll(".receipt-toggle")[0] },
    { code: "t", label: "T", el: () => document.querySelectorAll(".receipt-toggle")[1] },
    { code: "p", label: "P", el: () => $("actApprove") },
    { code: "o", label: "O", el: () => $("actApproveNoPrint") },
    { code: "k", label: "K", el: () => $("actSkip") },
    { code: "x", label: "X", el: () => $("actDelete") },
    { code: "arrowleft", label: "←", el: () => $("prevBtn") },
    { code: "arrowright", label: "→", el: () => $("nextBtn") },
    { code: "[", label: "[", el: () => $("cal_prev") },
    { code: "]", label: "]", el: () => $("cal_next") },
    { code: "g", label: "G", el: () => $("settingsBtn") },
  ];
  let keyTipsOpen = false;

  const normKey = (e) => String(e.key || "").toLowerCase();
  const elVisible = (el) => !!(el && el.offsetParent !== null && el.getClientRects().length);
  function canUseKeyTips() {
    return state.view === "review" &&
      $("settingsModal").classList.contains("hidden") &&
      $("confirmModal").classList.contains("hidden");
  }
  function triggerKeytip(k) {
    const el = k.el();
    if (!el) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      el.focus();
      if (el.tagName !== "SELECT" && el.select) { try { el.select(); } catch (_) {} }
    } else {
      el.click();
    }
  }
  function renderKeytips() {
    const layer = $("keytipLayer");
    if (!layer) return;
    layer.innerHTML = "";
    layer.classList.remove("hidden");
    KEYTIPS.forEach((k) => {
      const el = k.el();
      if (!elVisible(el)) return;
      const r = el.getBoundingClientRect();
      const b = document.createElement("span");
      b.className = "keytip";
      b.textContent = k.label;
      b.style.left = (r.left + r.width / 2) + "px";
      b.style.top = (r.top + r.height / 2) + "px";
      layer.appendChild(b);
    });
  }
  function onDocClickClose() { closeKeyTips(); }
  function openKeyTips() {
    if (keyTipsOpen) return;
    keyTipsOpen = true;
    renderKeytips();
    window.addEventListener("resize", renderKeytips);
    window.addEventListener("scroll", renderKeytips, true);
    setTimeout(() => document.addEventListener("click", onDocClickClose, true), 0);
  }
  function closeKeyTips() {
    if (!keyTipsOpen) return;
    keyTipsOpen = false;
    const layer = $("keytipLayer");
    if (layer) { layer.innerHTML = ""; layer.classList.add("hidden"); }
    window.removeEventListener("resize", renderKeytips);
    window.removeEventListener("scroll", renderKeytips, true);
    document.removeEventListener("click", onDocClickClose, true);
  }
  function handleKeytipKey(e) {
    if (e.key === "Alt") { e.preventDefault(); if (!e.repeat) closeKeyTips(); return; }
    if (e.key === "Shift" || e.key === "Control" || e.key === "Meta" || e.key === "CapsLock") return;
    e.preventDefault();
    if (e.key === "Escape") { closeKeyTips(); return; }
    const hit = KEYTIPS.find((k) => k.code === normKey(e) && elVisible(k.el()));
    closeKeyTips();
    if (hit) triggerKeytip(hit);
  }

  function onKey(e) {
    if (keyTipsOpen) { handleKeytipKey(e); return; }
    if (e.key === "Alt" && !e.repeat && canUseKeyTips()) { e.preventDefault(); openKeyTips(); return; }
    if (!$("settingsModal").classList.contains("hidden")) {
      if (e.key === "Escape") closeSettings();
      return;
    }
    if (state.view !== "review") { if (e.key === "Escape") showReview(); return; }
    if (!$("confirmModal").classList.contains("hidden")) {
      if (e.key === "Enter") { e.preventDefault(); doDelete(); }
      else if (e.key === "Escape") { $("confirmModal").classList.add("hidden"); pendingDelete = null; }
      return;
    }
    const tag = e.target.tagName;
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
    if (e.key === "Enter") {
      if (tag === "TEXTAREA") return;
      e.preventDefault(); approve({ noPrint: e.shiftKey }); return;
    }
    if (inField) { if (e.key === "Escape") e.target.blur(); return; }
    switch (e.key) {
      case "ArrowRight": case " ": e.preventDefault(); move(1); break;
      case "ArrowLeft": move(-1); break;
      case "[": calMonth(-1); break;
      case "]": calMonth(1); break;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("period").addEventListener("change", savePeriod);
    $("period").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); savePeriod(); e.target.blur(); } });
    document.querySelectorAll(".mission-tab").forEach((b) => b.addEventListener("click", () => switchMission(b.dataset.mission)));
    $("prevBtn").addEventListener("click", () => move(-1));
    $("nextBtn").addEventListener("click", () => move(1));
    $("historyBtn").addEventListener("click", () => { closeSettings(); (state.view === "review" ? showHistory() : showReview()); });
    $("backToReview").addEventListener("click", showReview);
    $("settingsBtn").addEventListener("click", openSettings);
    $("closeSettings").addEventListener("click", closeSettings);
    $("mySave").addEventListener("click", saveMysql);
    $("myTest").addEventListener("click", testMysql);
    $("fundSave").addEventListener("click", saveFund);
    $("fundStart").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveFund(); } });
    $("openDashboard").addEventListener("click", () => window.open(dashboardUrl(), "_blank"));
    $("fundBox").addEventListener("click", () => window.open(dashboardUrl(), "_blank"));
    ["myHost", "myPort", "myDb", "myUser", "myTable", "myPassword"].forEach((id) =>
      $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveMysql(); } }));
    $("settingsModal").addEventListener("click", (e) => { if (e.target.id === "settingsModal") closeSettings(); });
    $("confirmCancel").addEventListener("click", () => { $("confirmModal").classList.add("hidden"); pendingDelete = null; });
    $("confirmOk").addEventListener("click", doDelete);
    document.addEventListener("keydown", onKey);
    // Swallow the lone-Alt keyup so the browser does not pull focus to its menu bar.
    document.addEventListener("keyup", (e) => { if (e.key === "Alt" && state.view === "review") e.preventDefault(); });
    load().catch(() => toast("Could not load transactions", "err"));
  });
})();

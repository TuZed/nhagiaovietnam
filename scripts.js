"use strict";

/**
 * Sổ Ủng Hộ 20/11 — ứng dụng ghi nhận ủng hộ thầy cô.
 * Real-time qua BroadcastChannel (fallback: storage event).
 * Kahoot-style entrance + confetti canvas particle system.
 */
(function () {
  /* ==========================================================
     1. CONSTANTS
     ========================================================== */
  const STORAGE_KEY = "so-ghi-nhan.v1";
  const THEME_KEY = "so-ghi-nhan.theme";
  const CHANNEL_NAME = "so-ghi-nhan";
  const SCHEMA_VERSION = 1;

  const MAX_ENTRIES = 500;
  const MAX_NAME_LENGTH = 60;
  const MAX_AMOUNT = 1_000_000_000_000;
  const TOAST_DURATION = 2800;

  const COUNT_UP_TOTAL_MS = 550;
  const COUNT_UP_COUNT_MS = 450;

  const CONFETTI_THROTTLE_MS = 700;
  const CONFETTI_BURST_SIZE = 60;

  const AVATAR_COLOR_COUNT = 7;

  /* ==========================================================
     2. STATE
     ========================================================== */
  const state = {
    page: document.body.dataset.page || "ledger",
    entries: [],
    theme: "light",
    highlightId: null,
    storageOk: true,
    initialized: false,
    pendingConfirm: null,
    lastBurstAt: 0
  };

  /* ==========================================================
     3. DOM REFERENCES
     ========================================================== */
  const dom = {};

  function cacheDom() {
    dom.themeToggle = document.getElementById("themeToggle");
    dom.toastRegion = document.getElementById("toastRegion");
    dom.confettiCanvas = document.getElementById("confettiCanvas");

    if (state.page === "ledger") {
      dom.heroTotal = document.getElementById("heroTotal");
      dom.heroCount = document.getElementById("heroCount");
      dom.ledgerBody = document.getElementById("ledgerBody");
      dom.ledgerFrame = document.getElementById("ledgerFrame");
      dom.emptyState = document.getElementById("emptyState");
    }

    if (state.page === "input") {
      dom.adminTotal = document.getElementById("adminTotal");
      dom.adminCount = document.getElementById("adminCount");
      dom.entryForm = document.getElementById("entryForm");
      dom.nameInput = document.getElementById("nameInput");
      dom.nameError = document.getElementById("nameError");
      dom.amountInput = document.getElementById("amountInput");
      dom.amountError = document.getElementById("amountError");
      dom.exportBtn = document.getElementById("exportBtn");
      dom.clearBtn = document.getElementById("clearBtn");
      dom.submitBtn = document.getElementById("submitBtn");
      dom.manageList = document.getElementById("manageList");
      dom.manageEmpty = document.getElementById("manageEmpty");
      dom.manageCount = document.getElementById("manageCount");
      dom.confirmDialog = document.getElementById("confirmDialog");
      dom.dialogTitle = document.getElementById("dialogTitle");
      dom.dialogDesc = document.getElementById("dialogDesc");
      dom.dialogConfirm = document.getElementById("dialogConfirm");
    }
  }

  /* ==========================================================
     4. UTILITIES
     ========================================================== */
  const vndFormatter = new Intl.NumberFormat("vi-VN");
  const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  function formatVND(value) {
    return vndFormatter.format(value) + "\u00A0₫";
  }

  function formatVNDNumber(value) {
    return vndFormatter.format(value);
  }

  function formatDateTime(timestamp) {
    try {
      return dateFormatter.format(new Date(timestamp));
    } catch (error) {
      return "";
    }
  }

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function parseAmount(raw) {
    if (typeof raw !== "string") return NaN;
    const digits = raw.replace(/\D/g, "");
    if (!digits) return NaN;
    const value = Number(digits);
    return Number.isFinite(value) ? value : NaN;
  }

  function formatAmountField(input) {
    const digits = input.value.replace(/\D/g, "").slice(0, 15);
    input.value = digits ? vndFormatter.format(Number(digits)) : "";
  }

  function csvEscape(value) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function todayStamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function prefersReducedMotion() {
    return window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function hashName(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function getColorIndex(name) {
    return hashName(name) % AVATAR_COLOR_COUNT;
  }

  function getInitials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    const first = parts[0][0] || "";
    const last = parts[parts.length - 1][0] || "";
    return (first + last).toUpperCase();
  }

  function getDisplayedNumber(el) {
    if (!el) return 0;
    const digits = (el.textContent || "").replace(/\D/g, "");
    return digits ? Number(digits) : 0;
  }

  function animateNumber(el, to, duration, formatter) {
    if (!el) return;

    const from = getDisplayedNumber(el);

    if (el._rafId) {
      cancelAnimationFrame(el._rafId);
      el._rafId = null;
    }

    if (prefersReducedMotion() || from === to || duration <= 0) {
      el.textContent = formatter(to);
      return;
    }

    const start = performance.now();
    const diff = to - from;

    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + diff * eased;
      el.textContent = formatter(Math.round(value));

      if (t < 1) {
        el._rafId = requestAnimationFrame(step);
      } else {
        el.textContent = formatter(to);
        el._rafId = null;
      }
    }

    el._rafId = requestAnimationFrame(step);
  }

  function bounceElement(el) {
    if (!el || prefersReducedMotion()) return;
    el.classList.remove("is-bouncing");
    void el.offsetWidth;
    el.classList.add("is-bouncing");
    window.clearTimeout(el._bounceTimer);
    el._bounceTimer = window.setTimeout(() => {
      el.classList.remove("is-bouncing");
    }, 620);
  }

  /* ==========================================================
     5. STORAGE LAYER
     ========================================================== */
  function probeStorage() {
    try {
      const key = "__so_ghi_nhan_probe__";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn("[Sổ Ủng Hộ] localStorage không khả dụng:", error);
      return false;
    }
  }

  function sanitizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const result = [];

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;

      const name =
        typeof item.name === "string"
          ? item.name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH)
          : "";
      const amount = Number(item.amount);
      const createdAt = Number(item.createdAt);

      if (!name) continue;
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) continue;
      if (!Number.isFinite(createdAt) || createdAt <= 0) continue;

      result.push({
        id: typeof item.id === "string" && item.id ? item.id : createId(),
        name,
        amount: Math.round(amount),
        createdAt
      });
    }

    result.sort((a, b) => b.createdAt - a.createdAt);
    return result.slice(0, MAX_ENTRIES);
  }

  function readEntries() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn("[Sổ Ủng Hộ] Không đọc được dữ liệu:", error);
      state.storageOk = false;
      return [];
    }

    if (!raw) return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn("[Sổ Ủng Hộ] Dữ liệu hỏng, bỏ qua:", error);
      return [];
    }

    if (!parsed || typeof parsed !== "object") return [];
    return sanitizeEntries(parsed.entries);
  }

  function writeEntries(entries) {
    const payload = JSON.stringify({ version: SCHEMA_VERSION, entries });
    try {
      localStorage.setItem(STORAGE_KEY, payload);
      state.storageOk = true;
      return true;
    } catch (error) {
      state.storageOk = false;
      console.error("[Sổ Ủng Hộ] Không ghi được dữ liệu:", error);
      return false;
    }
  }

  function clearStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (error) {
      console.error("[Sổ Ủng Hộ] Không xóa được dữ liệu:", error);
      return false;
    }
  }

  /* ==========================================================
     6. CROSS-TAB CHANNEL
     ========================================================== */
  let channel = null;
  let refreshTimer = null;

  function initChannel() {
    if (!("BroadcastChannel" in window)) return;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data && event.data.type === "update") {
          scheduleRefresh();
        }
      };
    } catch (error) {
      console.warn("[Sổ Ủng Hộ] BroadcastChannel không khả dụng:", error);
    }
  }

  function broadcastUpdate() {
    if (!channel) return;
    try {
      channel.postMessage({ type: "update", ts: Date.now() });
    } catch (error) {
      console.warn("[Sổ Ủng Hộ] Broadcast thất bại:", error);
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshFromStorage(true);
      refreshTimer = null;
    }, 60);
  }

  /* ==========================================================
     7. CONFETTI
     ========================================================== */
  const confetti = {
    canvas: null,
    ctx: null,
    particles: [],
    rafId: null,
    dpr: 1,
    w: 0,
    h: 0,
    tickBound: null,

    init(canvas) {
      if (!canvas) return;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.tickBound = this.tick.bind(this);
      this.resize();
      window.addEventListener("resize", () => this.resize());
    },

    resize() {
      if (!this.canvas) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.canvas.width = this.w * this.dpr;
      this.canvas.height = this.h * this.dpr;
      this.canvas.style.width = this.w + "px";
      this.canvas.style.height = this.h + "px";
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    },

    burst(count) {
      if (!this.ctx || prefersReducedMotion()) return;

      const colors = [
        "#e11d48", "#f43f5e", "#ec4899", "#fbbf24",
        "#f97316", "#10b981", "#0ea5e9", "#8b5cf6"
      ];

      const originX = this.w / 2;
      const originY = this.h * 0.28;

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const speed = 6 + Math.random() * 9;

        this.particles.push({
          x: originX + (Math.random() - 0.5) * 40,
          y: originY + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 5,
          size: 6 + Math.random() * 8,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.35,
          life: 0,
          maxLife: 90 + Math.random() * 50,
          shape: Math.random() < 0.55 ? "rect" : "circle",
          gravity: 0.35 + Math.random() * 0.15
        });
      }

      if (this.particles.length > 220) {
        this.particles = this.particles.slice(-220);
      }

      if (!this.rafId) {
        this.rafId = requestAnimationFrame(this.tickBound);
      }
    },

    tick() {
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;
      ctx.clearRect(0, 0, w, h);

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.vy += p.gravity;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        p.life++;

        const alpha = Math.max(0, 1 - p.life / p.maxLife);

        if (alpha <= 0 || p.y > h + 60) {
          this.particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;

        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      if (this.particles.length > 0) {
        this.rafId = requestAnimationFrame(this.tickBound);
      } else {
        ctx.clearRect(0, 0, w, h);
        this.rafId = null;
      }
    }
  };

  function fireCelebration(force) {
    const now = performance.now();
    if (!force && now - state.lastBurstAt < CONFETTI_THROTTLE_MS) return;
    state.lastBurstAt = now;
    confetti.burst(CONFETTI_BURST_SIZE);
  }

  /* ==========================================================
     8. THEME
     ========================================================== */
  function applyTheme(theme, persist) {
    const next = theme === "dark" ? "dark" : "light";
    state.theme = next;
    document.documentElement.setAttribute("data-theme", next);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", next === "dark" ? "#1a0f1a" : "#fff7ef");
    }

    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (error) {
        console.warn("[Sổ Ủng Hộ] Không lưu theme:", error);
      }
    }

    if (dom.themeToggle) {
      const goingDark = next === "light";
      dom.themeToggle.setAttribute("aria-pressed", String(next === "dark"));
      dom.themeToggle.setAttribute(
        "aria-label",
        goingDark ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng"
      );
    }
  }

  function initTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark" || current === "light") {
      applyTheme(current, false);
      return;
    }
    const prefersDark =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light", false);
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark", true);
  }

  /* ==========================================================
     9. TOASTS
     ========================================================== */
  function toast(message, variant) {
    if (!dom.toastRegion) return;

    const element = document.createElement("div");
    element.className = "toast" + (variant ? " toast--" + variant : "");
    element.textContent = message;
    dom.toastRegion.append(element);

    while (dom.toastRegion.children.length > 2) {
      dom.toastRegion.firstElementChild.remove();
    }

    window.setTimeout(() => {
      element.classList.add("is-leaving");
      window.setTimeout(() => element.remove(), 220);
    }, TOAST_DURATION);
  }

  /* ==========================================================
     10. RENDERING — LEDGER
     ========================================================== */
  function renderHero(animate) {
    if (dom.heroTotal) {
      const total = state.entries.reduce((sum, entry) => sum + entry.amount, 0);
      if (animate) {
        animateNumber(dom.heroTotal, total, COUNT_UP_TOTAL_MS, formatVNDNumber);
        bounceElement(dom.heroTotal);
      } else {
        dom.heroTotal.textContent = formatVNDNumber(total);
      }
    }

    if (dom.heroCount) {
      const count = state.entries.length;
      if (animate) {
        animateNumber(dom.heroCount, count, COUNT_UP_COUNT_MS, formatVNDNumber);
      } else {
        dom.heroCount.textContent = formatVNDNumber(count);
      }
    }
  }

  function buildEntryCell(entry) {
    const cell = document.createElement("td");
    cell.className = "ledger__cell ledger__cell--name";

    const wrap = document.createElement("div");
    wrap.className = "entry";

    const avatar = document.createElement("span");
    avatar.className = "entry__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = getInitials(entry.name);

    const body = document.createElement("div");
    body.className = "entry__body";

    const name = document.createElement("span");
    name.className = "entry__name";
    name.textContent = entry.name;
    name.title = entry.name;

    const time = document.createElement("span");
    time.className = "entry__time";
    time.textContent = formatDateTime(entry.createdAt);

    body.append(name, time);
    wrap.append(avatar, body);
    cell.append(wrap);
    return cell;
  }

  function renderLedger() {
    if (!dom.ledgerBody) return;

    const fragment = document.createDocumentFragment();

    for (const entry of state.entries) {
      const row = document.createElement("tr");
      row.className = "ledger__row";
      row.setAttribute("data-color", String(getColorIndex(entry.name)));
      if (entry.id === state.highlightId) {
        row.classList.add("ledger__row--new");
      }

      const amountCell = document.createElement("td");
      amountCell.className = "ledger__cell ledger__cell--amount";
      const amountEl = document.createElement("span");
      amountEl.className = "entry__amount";
      amountEl.textContent = formatVND(entry.amount);
      amountCell.append(amountEl);

      row.append(buildEntryCell(entry), amountCell);
      fragment.append(row);
    }

    dom.ledgerBody.textContent = "";
    dom.ledgerBody.append(fragment);
    state.highlightId = null;
  }

  function renderLedgerEmptyState() {
    if (!dom.emptyState || !dom.ledgerFrame) return;
    const isEmpty = state.entries.length === 0;
    dom.emptyState.hidden = !isEmpty;
    dom.ledgerFrame.hidden = isEmpty;
  }

  function renderLedgerPage(animateHero) {
    renderHero(animateHero);
    renderLedger();
    renderLedgerEmptyState();
  }

  /* ==========================================================
     11. RENDERING — ADMIN
     ========================================================== */
  const trashIconSvg =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="3 6 5 6 21 6"></polyline>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
    '<path d="M10 11v6M14 11v6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>' +
    "</svg>";

  function buildDeleteButton(entry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "manage-item__delete";
    button.setAttribute("data-delete-id", entry.id);
    button.setAttribute("aria-label", "Xóa " + entry.name);
    button.title = "Xóa ủng hộ";

    const template = document.createElement("template");
    template.innerHTML = trashIconSvg;
    button.append(template.content.cloneNode(true));
    return button;
  }

  function renderAdminStats() {
    const total = state.entries.reduce((sum, entry) => sum + entry.amount, 0);

    if (dom.adminCount) {
      dom.adminCount.textContent = vndFormatter.format(state.entries.length);
    }
    if (dom.adminTotal) {
      dom.adminTotal.textContent = formatVND(total);
    }
    if (dom.manageCount) {
      dom.manageCount.textContent = vndFormatter.format(state.entries.length);
    }
  }

  function renderManageList() {
    if (!dom.manageList || !dom.manageEmpty) return;

    if (state.entries.length === 0) {
      dom.manageList.textContent = "";
      dom.manageEmpty.hidden = false;
      return;
    }

    dom.manageEmpty.hidden = true;
    const fragment = document.createDocumentFragment();

    for (const entry of state.entries) {
      const item = document.createElement("li");
      item.className = "manage-item";
      item.setAttribute("data-color", String(getColorIndex(entry.name)));
      if (entry.id === state.highlightId) {
        item.classList.add("is-new");
      }

      const body = document.createElement("div");
      body.className = "manage-item__body";

      const avatar = document.createElement("span");
      avatar.className = "manage-item__avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = getInitials(entry.name);

      const text = document.createElement("div");
      text.className = "manage-item__text";

      const name = document.createElement("span");
      name.className = "manage-item__name";
      name.textContent = entry.name;
      name.title = entry.name;

      const meta = document.createElement("span");
      meta.className = "manage-item__meta";
      meta.textContent = formatDateTime(entry.createdAt);

      text.append(name, meta);
      body.append(avatar, text);

      const amount = document.createElement("span");
      amount.className = "manage-item__amount";
      amount.textContent = formatVND(entry.amount);

      const deleteBtn = buildDeleteButton(entry);

      item.append(body, amount, deleteBtn);
      fragment.append(item);
    }

    dom.manageList.textContent = "";
    dom.manageList.append(fragment);
    state.highlightId = null;
  }

  function updateDataActions() {
    const hasEntries = state.entries.length > 0;
    if (dom.exportBtn) dom.exportBtn.disabled = !hasEntries;
    if (dom.clearBtn) dom.clearBtn.disabled = !hasEntries;
  }

  function renderAdminPage() {
    renderAdminStats();
    renderManageList();
    updateDataActions();
  }

  /* ==========================================================
     12. VALIDATION
     ========================================================== */
  function setFieldError(input, errorElement, message) {
    if (!input || !errorElement) return;
    if (message) {
      input.setAttribute("aria-invalid", "true");
      errorElement.textContent = message;
    } else {
      input.removeAttribute("aria-invalid");
      errorElement.textContent = "";
    }
  }

  function clearFieldErrors() {
    setFieldError(dom.nameInput, dom.nameError, "");
    setFieldError(dom.amountInput, dom.amountError, "");
  }

  function validateForm() {
    clearFieldErrors();
    let firstInvalid = null;

    const rawName = dom.nameInput ? dom.nameInput.value : "";
    const name = rawName.trim().replace(/\s+/g, " ");

    if (!name) {
      setFieldError(dom.nameInput, dom.nameError, "Vui lòng nhập tên.");
      firstInvalid = firstInvalid || dom.nameInput;
    } else if (name.length > MAX_NAME_LENGTH) {
      setFieldError(
        dom.nameInput,
        dom.nameError,
        `Tối đa ${MAX_NAME_LENGTH} ký tự (hiện ${name.length}).`
      );
      firstInvalid = firstInvalid || dom.nameInput;
    }

    const amount = parseAmount(dom.amountInput ? dom.amountInput.value : "");

    if (!Number.isFinite(amount) || amount <= 0) {
      setFieldError(dom.amountInput, dom.amountError, "Phải là số lớn hơn 0.");
      firstInvalid = firstInvalid || dom.amountInput;
    } else if (amount > MAX_AMOUNT) {
      setFieldError(dom.amountInput, dom.amountError, "Vượt giới hạn cho phép.");
      firstInvalid = firstInvalid || dom.amountInput;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }

    return { name, amount };
  }

  /* ==========================================================
     13. DIALOG
     ========================================================== */
  function openConfirm(options) {
    if (!dom.confirmDialog) return;
    dom.dialogTitle.textContent = options.title;
    dom.dialogDesc.textContent = options.message;
    dom.dialogConfirm.textContent = options.confirmLabel;
    state.pendingConfirm = typeof options.action === "function" ? options.action : null;
    dom.confirmDialog.returnValue = "";
    dom.confirmDialog.showModal();
  }

  function handleDialogClose() {
    const action = state.pendingConfirm;
    state.pendingConfirm = null;
    if (dom.confirmDialog.returnValue === "confirm" && action) {
      action();
    }
  }

  function handleDialogBackdropClick(event) {
    if (event.target === dom.confirmDialog) {
      dom.confirmDialog.close("cancel");
    }
  }

  /* ==========================================================
     14. ACTIONS
     ========================================================== */
  function addEntry(event) {
    event.preventDefault();

    const values = validateForm();
    if (!values) return;

    const entry = {
      id: createId(),
      name: values.name,
      amount: values.amount,
      createdAt: Date.now()
    };

    const next = [entry, ...state.entries].slice(0, MAX_ENTRIES);

    if (!writeEntries(next)) {
      toast("Không lưu được dữ liệu. Kiểm tra dung lượng trình duyệt.", "error");
      return;
    }

    state.entries = next;
    state.highlightId = entry.id;

    broadcastUpdate();
    renderAdminPage();
    dom.entryForm.reset();
    clearFieldErrors();
    dom.nameInput.focus();

    if (dom.submitBtn) bounceElement(dom.submitBtn);
    fireCelebration(true);
    toast(`🎉 Đã thêm "${entry.name}"`, "success");
  }

  function requestClearAll() {
    if (state.entries.length === 0) {
      toast("Không có dữ liệu để xóa.", "warning");
      return;
    }
    openConfirm({
      title: "Xóa toàn bộ dữ liệu?",
      message: `Toàn bộ ${state.entries.length} mục sẽ bị xóa vĩnh viễn. Không thể hoàn tác.`,
      confirmLabel: "Xóa tất cả",
      action: performClearAll
    });
  }

  function performClearAll() {
    if (!clearStorage()) {
      toast("Không xóa được dữ liệu.", "error");
      return;
    }

    state.entries = [];
    state.highlightId = null;
    broadcastUpdate();
    renderAdminPage();
    toast("Đã xóa toàn bộ danh sách.", "success");
  }

  function requestDeleteEntry(id) {
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) return;
    openConfirm({
      title: "Xóa ủng hộ?",
      message: `"${entry.name}" — ${formatVND(entry.amount)} sẽ bị xóa.`,
      confirmLabel: "Xóa",
      action: () => performDeleteEntry(id)
    });
  }

  function performDeleteEntry(id) {
    const target = state.entries.find((item) => item.id === id);
    const next = state.entries.filter((item) => item.id !== id);

    if (!writeEntries(next)) {
      toast("Không xóa được ủng hộ.", "error");
      return;
    }

    state.entries = next;
    state.highlightId = null;
    broadcastUpdate();
    renderAdminPage();
    toast(target ? `Đã xóa "${target.name}".` : "Đã xóa ủng hộ.", "success");
  }

  function exportCsv() {
    if (state.entries.length === 0) {
      toast("Chưa có dữ liệu để xuất.", "warning");
      return;
    }

    const header = ["STT", "Tên", "Số tiền (VND)", "Thời gian (ISO)"];
    const lines = [header.map(csvEscape).join(",")];

    state.entries.forEach((entry, index) => {
      lines.push(
        [index + 1, entry.name, entry.amount, new Date(entry.createdAt).toISOString()]
          .map(csvEscape)
          .join(",")
      );
    });

    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `so-ung-ho-20-11_${todayStamp()}.csv`;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`Đã xuất ${state.entries.length} dòng.`, "success");
  }

  /* ==========================================================
     15. SYNC
     ========================================================== */
  function refreshFromStorage(announce) {
    const previousTopId = state.entries.length > 0 ? state.entries[0].id : null;
    const nextEntries = readEntries();
    const newTopId = nextEntries.length > 0 ? nextEntries[0].id : null;
    const hasNewEntry = !!newTopId && newTopId !== previousTopId;

    if (hasNewEntry) {
      state.highlightId = newTopId;
    }

    state.entries = nextEntries;

    if (state.page === "ledger") {
      renderLedgerPage(hasNewEntry);
      if (hasNewEntry && announce) {
        fireCelebration(false);
        toast("🎉 Vừa có người ủng hộ mới!", "success");
      }
    } else {
      renderAdminPage();
    }
  }

  function handleStorageEvent(event) {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    scheduleRefresh();
  }

  function handleVisibilityChange() {
    if (!document.hidden) {
      // Đồng bộ lại khi tab được active trở lại — không phát confetti.
      refreshFromStorage(false);
    }
  }

  /* ==========================================================
     16. EVENT BINDING
     ========================================================== */
  function bindCommonEvents() {
    if (dom.themeToggle) {
      dom.themeToggle.addEventListener("click", toggleTheme);
    }

    window.addEventListener("storage", handleStorageEvent);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        refreshFromStorage(false);
      }
    });
  }

  function bindInputEvents() {
    if (dom.entryForm) {
      dom.entryForm.addEventListener("submit", addEntry);
    }

    if (dom.amountInput) {
      dom.amountInput.addEventListener("input", () => {
        formatAmountField(dom.amountInput);
        if (dom.amountInput.getAttribute("aria-invalid") === "true") {
          setFieldError(dom.amountInput, dom.amountError, "");
        }
      });
    }

    if (dom.nameInput) {
      dom.nameInput.addEventListener("input", () => {
        if (dom.nameInput.getAttribute("aria-invalid") === "true") {
          setFieldError(dom.nameInput, dom.nameError, "");
        }
      });
    }

    if (dom.exportBtn) {
      dom.exportBtn.addEventListener("click", exportCsv);
    }

    if (dom.clearBtn) {
      dom.clearBtn.addEventListener("click", requestClearAll);
    }

    if (dom.manageList) {
      dom.manageList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-delete-id]");
        if (!button) return;
        requestDeleteEntry(button.getAttribute("data-delete-id"));
      });
    }

    if (dom.confirmDialog) {
      dom.confirmDialog.addEventListener("close", handleDialogClose);
      dom.confirmDialog.addEventListener("click", handleDialogBackdropClick);
    }
  }

  /* ==========================================================
     17. INITIALIZATION
     ========================================================== */
  function initialize() {
    if (state.initialized) return;
    state.initialized = true;

    cacheDom();
    initTheme();

    if (dom.confettiCanvas) {
      confetti.init(dom.confettiCanvas);
    }

    state.storageOk = probeStorage();
    state.entries = readEntries();

    if (!state.storageOk) {
      toast("Trình duyệt không cho phép lưu dữ liệu.", "error");
    }

    initChannel();
    bindCommonEvents();

    if (state.page === "ledger") {
      renderLedgerPage(false);
    } else if (state.page === "input") {
      bindInputEvents();
      renderAdminPage();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
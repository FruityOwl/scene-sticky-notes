// Scene Sticky Notes
// Sticky notes that sit on the scene itself. The whole text is on the note and is
// edited right there, and a note can be moved and resized with its text reflowing.
// Each scene keeps its notes in its own flags, so every connected client follows.

const MODULE_ID = "scene-sticky-notes";
const FLAG = "notes";
const LAYER_ID = "ssn-layer";
const SAVE_DELAY = 500;
const COLORS = ["yellow", "green", "blue", "pink", "white"];
// On screen, at the zoom a note is made or resized at. Stored sizes are in scene pixels.
const NEW_SIZE = { width: 300, height: 200 };
const MIN_SIZE = { width: 140, height: 80 };
const NEW_FONT = 16;
const FONT_STEP = 1.15;

const t = (key, data = null) => data ? game.i18n.format(`SSN.${key}`, data) : game.i18n.localize(`SSN.${key}`);

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function number(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Anything that reaches the page goes through here, so a hand-edited flag can't break it.
function normalize(note) {
  return {
    x: number(note.x, 0),
    y: number(note.y, 0),
    width: number(note.width, NEW_SIZE.width, 20),
    height: number(note.height, NEW_SIZE.height, 20),
    text: typeof note.text === "string" ? note.text : "",
    color: COLORS.includes(note.color) ? note.color : COLORS[0],
    fontSize: number(note.fontSize, NEW_FONT, 2, 800),
    collapsed: Boolean(note.collapsed),
    visible: Boolean(note.visible)
  };
}

const firstLine = (text) => text.split("\n").find((line) => line.trim())?.trim() ?? "";

class StickyNotes {
  static layer = null;
  static board = null;
  static offset = { left: 0, top: 0 };
  static matrix = "";
  static scale = 1;
  static elements = new Map();
  static pending = new Map();
  static gesture = null;
  static top = 0;

  static get scene() {
    return globalThis.canvas?.ready ? canvas.scene : null;
  }

  static notes(scene = this.scene) {
    const notes = scene?.getFlag(MODULE_ID, FLAG);
    return notes && typeof notes === "object" ? notes : {};
  }

  /* -------------------------------------------- */
  /*  The layer over the canvas                    */
  /* -------------------------------------------- */

  // The notes live in one element over the board, which copies the canvas's own
  // transform every frame. A note is placed in scene pixels and moves and zooms
  // with the map, while its text stays a real text box the browser edits.
  static mount() {
    this.unmount();
    const board = document.getElementById("board") ?? canvas.app?.view;
    if (!board || !canvas.scene) return;
    const layer = document.createElement("div");
    layer.id = LAYER_ID;
    // Right after the board and at its level: above the map, below the interface.
    board.after(layer);
    const z = getComputedStyle(board).zIndex;
    if (z !== "auto") layer.style.zIndex = z;
    this.board = board;
    this.layer = layer;
    this.measure();
    canvas.app.ticker.add(this.follow, this, globalThis.PIXI?.UPDATE_PRIORITY?.UTILITY ?? -50);
    this.follow();
    this.render();
  }

  static unmount() {
    for (const id of [...this.pending.keys()]) this.flush(id);
    globalThis.canvas?.app?.ticker?.remove(this.follow, this);
    this.layer?.remove();
    this.layer = null;
    this.elements.clear();
    this.gesture = null;
    this.matrix = "";
  }

  static measure() {
    if (!this.board) return;
    const { left, top } = this.board.getBoundingClientRect();
    this.offset = { left, top };
    this.matrix = "";
  }

  // Runs after each render, when the stage's transform is up to date.
  static follow() {
    const m = canvas.stage?.worldTransform;
    if (!m || !this.layer) return;
    const css = `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.tx + this.offset.left}, ${m.ty + this.offset.top})`;
    if (css === this.matrix) return;
    this.matrix = css;
    this.scale = Math.hypot(m.a, m.b) || 1;
    this.layer.style.transform = css;
  }

  /* -------------------------------------------- */
  /*  Drawing the notes                            */
  /* -------------------------------------------- */

  static render() {
    if (!this.layer) return;
    const seen = new Set();
    for (const [id, raw] of Object.entries(this.notes())) {
      if (!raw || typeof raw !== "object") continue;
      const note = normalize(raw);
      if (!game.user.isGM && !note.visible) continue;
      seen.add(id);
      let el = this.elements.get(id);
      if (!el) {
        el = this.build(id);
        this.elements.set(id, el);
        this.layer.append(el);
      }
      this.fill(el, id, note);
    }
    for (const [id, el] of this.elements) {
      if (seen.has(id)) continue;
      el.remove();
      this.elements.delete(id);
    }
  }

  static tool(action, icon) {
    return `<button type="button" class="ssn-tool" data-action="${action}"><i class="${icon}" aria-hidden="true"></i></button>`;
  }

  static build(id) {
    const gm = game.user.isGM;
    const el = document.createElement("section");
    el.className = "ssn-note";
    el.dataset.id = id;
    el.innerHTML = `
      <header class="ssn-head">
        <i class="ssn-shared fa-solid fa-eye" aria-hidden="true"></i>
        <span class="ssn-title"></span>
        ${gm ? `<menu class="ssn-tools">
          ${this.tool("color", "fa-solid fa-palette")}
          ${this.tool("smaller", "fa-solid fa-minus")}
          ${this.tool("larger", "fa-solid fa-plus")}
          ${this.tool("visible", "fa-solid fa-eye-slash")}
          ${this.tool("editor", "fa-solid fa-up-right-and-down-left-from-center")}
          ${this.tool("collapse", "fa-solid fa-chevron-up")}
          ${this.tool("delete", "fa-solid fa-trash")}
        </menu>` : ""}
      </header>
      ${gm
        ? `<textarea class="ssn-text" spellcheck="true" placeholder="${escapeHtml(t("Placeholder"))}"></textarea><div class="ssn-resize"></div>`
        : `<div class="ssn-text"></div>`}`;

    el.querySelector(".ssn-shared").title = t("Shared");
    el.addEventListener("pointerdown", () => {
      el.style.zIndex = String(++this.top);
    });
    if (!gm) return el;

    const tips = { color: "Colour", smaller: "Smaller", larger: "Larger", editor: "OpenEditor", delete: "Delete" };
    for (const button of el.querySelectorAll(".ssn-tool")) {
      const tip = tips[button.dataset.action];
      if (tip) button.title = button.ariaLabel = t(tip);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.onTool(id, button.dataset.action);
      });
    }

    const head = el.querySelector(".ssn-head");
    head.title = t("Move");
    head.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".ssn-tool")) this.startGesture(event, id, "move");
    });
    head.addEventListener("dblclick", (event) => {
      if (!event.target.closest(".ssn-tool")) this.onTool(id, "collapse");
    });
    const handle = el.querySelector(".ssn-resize");
    handle.title = t("Resize");
    handle.addEventListener("pointerdown", (event) => this.startGesture(event, id, "resize"));
    for (const target of [head, handle]) {
      target.addEventListener("pointermove", (event) => this.moveGesture(event));
      target.addEventListener("pointerup", (event) => this.endGesture(event));
      target.addEventListener("pointercancel", (event) => this.endGesture(event));
    }

    const text = el.querySelector("textarea");
    text.addEventListener("input", () => this.schedule(id, text));
    text.addEventListener("blur", () => this.flush(id));
    // Keys typed into a note are for the note, not for Foundry's shortcuts.
    text.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") text.blur();
    });
    return el;
  }

  static fill(el, id, note) {
    const moving = this.gesture?.id === id;
    if (!moving) {
      el.style.left = `${note.x}px`;
      el.style.top = `${note.y}px`;
      el.style.width = `${note.width}px`;
      el.style.height = `${note.height}px`;
    }
    el.style.setProperty("--ssn-font", `${note.fontSize}px`);
    el.dataset.color = note.color;
    el.classList.toggle("is-collapsed", note.collapsed);
    el.classList.toggle("is-shared", note.visible);
    el.querySelector(".ssn-title").textContent = firstLine(note.text);

    const text = el.querySelector(".ssn-text");
    if (text instanceof HTMLTextAreaElement) {
      // What's being typed wins over what was saved a moment ago.
      if (document.activeElement !== text && !this.pending.has(id) && text.value !== note.text) text.value = note.text;
    } else if (text.textContent !== note.text) {
      text.textContent = note.text;
    }

    const visible = el.querySelector('[data-action="visible"]');
    if (visible) {
      visible.querySelector("i").className = `fa-solid ${note.visible ? "fa-eye" : "fa-eye-slash"}`;
      visible.title = visible.ariaLabel = t(note.visible ? "HideFromPlayers" : "ShowToPlayers");
    }
    const collapse = el.querySelector('[data-action="collapse"]');
    if (collapse) {
      collapse.querySelector("i").className = `fa-solid ${note.collapsed ? "fa-chevron-down" : "fa-chevron-up"}`;
      collapse.title = collapse.ariaLabel = t(note.collapsed ? "Expand" : "Collapse");
    }
  }

  /* -------------------------------------------- */
  /*  Saving                                       */
  /* -------------------------------------------- */

  static async save(scene, id, patch) {
    if (!scene || !game.user.isGM) return;
    try {
      await scene.setFlag(MODULE_ID, `${FLAG}.${id}`, patch);
    } catch (error) {
      console.error(`${MODULE_ID} | saving note ${id}`, error);
      ui.notifications?.error(t("SaveFailed", { error: error?.message ?? error }));
    }
  }

  // Text is saved half a second after typing stops, and at once when the note loses focus.
  static schedule(id, text) {
    const entry = this.pending.get(id);
    if (entry) clearTimeout(entry.timer);
    const scene = entry?.scene ?? this.scene;
    const timer = setTimeout(() => this.flush(id), SAVE_DELAY);
    this.pending.set(id, { scene, text, timer });
  }

  static flush(id) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    const value = entry.text.value;
    if (value !== this.notes(entry.scene)[id]?.text) this.save(entry.scene, id, { text: value });
  }

  /* -------------------------------------------- */
  /*  Moving and resizing                          */
  /* -------------------------------------------- */

  static startGesture(event, id, kind) {
    if (event.button !== 0) return;
    const el = this.elements.get(id);
    const raw = this.notes()[id];
    if (!el || !raw) return;
    event.preventDefault();
    event.stopPropagation();
    const note = normalize(raw);
    this.gesture = {
      id, kind, el,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scale: this.scale,
      note,
      // Collapsed, a note is only as tall as its header.
      height: note.collapsed ? el.offsetHeight : note.height,
      result: null
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Not a live pointer (a synthetic event); the gesture still works while it stays over the note.
    }
    el.classList.add(kind === "move" ? "is-moving" : "is-resizing");
  }

  static moveGesture(event) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const dx = (event.clientX - g.startX) / g.scale;
    const dy = (event.clientY - g.startY) / g.scale;
    if (g.kind === "move") {
      g.result = { x: Math.round(g.note.x + dx), y: Math.round(g.note.y + dy) };
      g.el.style.left = `${g.result.x}px`;
      g.el.style.top = `${g.result.y}px`;
    } else {
      g.result = {
        width: Math.round(Math.max(MIN_SIZE.width / g.scale, g.note.width + dx)),
        height: Math.round(Math.max(MIN_SIZE.height / g.scale, g.height + dy))
      };
      g.el.style.width = `${g.result.width}px`;
      g.el.style.height = `${g.result.height}px`;
      // Making a collapsed note taller opens it.
      if (g.note.collapsed && g.result.height > g.height) g.result.collapsed = false;
    }
  }

  static endGesture(event) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    this.gesture = null;
    g.el.classList.remove("is-moving", "is-resizing");
    if (g.result) this.save(this.scene, g.id, g.result);
    else this.render();
  }

  /* -------------------------------------------- */
  /*  Creating, the buttons, the big editor        */
  /* -------------------------------------------- */

  // A new note goes in the middle of the screen at a comfortable size for the
  // current zoom, and its text box takes the cursor.
  static async create() {
    const scene = this.scene;
    if (!scene || !game.user.isGM) return;
    const scale = this.scale || 1;
    const center = canvas.canvasCoordinatesFromClient({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const width = Math.round(NEW_SIZE.width / scale);
    const height = Math.round(NEW_SIZE.height / scale);
    const id = foundry.utils.randomID();
    await this.save(scene, id, {
      x: Math.round(center.x - width / 2),
      y: Math.round(center.y - height / 2),
      width,
      height,
      text: "",
      color: COLORS[0],
      fontSize: Math.round(NEW_FONT / scale),
      collapsed: false,
      visible: false
    });
    const el = this.elements.get(id);
    if (!el) return;
    el.style.zIndex = String(++this.top);
    el.querySelector("textarea")?.focus();
  }

  static async onTool(id, action) {
    const scene = this.scene;
    const raw = this.notes(scene)[id];
    if (!raw) return;
    const note = normalize(raw);
    switch (action) {
      case "color":
        return this.save(scene, id, { color: COLORS[(COLORS.indexOf(note.color) + 1) % COLORS.length] });
      case "smaller":
        return this.save(scene, id, { fontSize: Math.max(2, Math.round(note.fontSize / FONT_STEP)) });
      case "larger":
        return this.save(scene, id, { fontSize: Math.min(800, Math.round(note.fontSize * FONT_STEP)) });
      case "visible":
        return this.save(scene, id, { visible: !note.visible });
      case "collapse":
        this.flush(id);
        return this.save(scene, id, { collapsed: !note.collapsed });
      case "editor":
        return this.openEditor(scene, id);
      case "delete":
        return this.remove(scene, id, note);
    }
  }

  static async remove(scene, id, note) {
    if (note.text.trim()) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("Delete") },
        content: `<p>${escapeHtml(t("DeleteConfirm", { title: firstLine(note.text) }))}</p>`,
        yes: { icon: "<i class='fa-solid fa-trash'></i>", label: t("Delete") },
        no: { label: t("Cancel") },
        modal: true
      });
      if (!confirmed) return;
    }
    const entry = this.pending.get(id);
    if (entry) clearTimeout(entry.timer);
    this.pending.delete(id);
    try {
      await scene.unsetFlag(MODULE_ID, `${FLAG}.${id}`);
    } catch (error) {
      console.error(`${MODULE_ID} | deleting note ${id}`, error);
      ui.notifications?.error(t("SaveFailed", { error: error?.message ?? error }));
    }
  }

  // For long texts: the same text in a big window that can be resized.
  static async openEditor(scene, id) {
    this.flush(id);
    const current = normalize(this.notes(scene)[id] ?? {}).text;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: firstLine(current) || t("EditorTitle"), resizable: true },
      position: { width: 640, height: 520 },
      classes: ["ssn-editor"],
      content: `<textarea name="ssnText" spellcheck="true" placeholder="${escapeHtml(t("Placeholder"))}">${escapeHtml(current)}</textarea>`,
      ok: {
        icon: "fa-solid fa-check",
        label: t("Save"),
        callback: (_event, button, dialog) => (button?.form ?? dialog?.element)?.querySelector?.('[name="ssnText"]')?.value
      },
      rejectClose: false
    });
    if (typeof result === "string" && this.notes(scene)[id] && result !== current) await this.save(scene, id, { text: result });
  }
}

Hooks.on("getSceneControlButtons", (controls) => {
  const group = controls.notes ?? controls.tokens;
  if (!group?.tools) return;
  group.tools.ssnNewNote = {
    name: "ssnNewNote",
    title: "SSN.NewNote",
    icon: "fa-solid fa-note-sticky",
    order: Object.keys(group.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: () => StickyNotes.create()
  };
});

Hooks.on("canvasReady", () => StickyNotes.mount());
Hooks.on("canvasTearDown", () => StickyNotes.unmount());
Hooks.on("updateScene", (scene, changes) => {
  if (scene.id === globalThis.canvas?.scene?.id && changes?.flags?.[MODULE_ID] !== undefined) StickyNotes.render();
});
window.addEventListener("resize", () => StickyNotes.measure());

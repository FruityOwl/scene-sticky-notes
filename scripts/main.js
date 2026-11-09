// Scene Sticky Notes
// Sticky notes that sit on the scene itself. The whole text is on the note and is
// edited right there, with formatting, and a note can be moved and resized with
// its text reflowing. Each scene keeps its notes in its own flags, so every
// connected client follows.

const MODULE_ID = "scene-sticky-notes";
const FLAG = "notes";
const LAYER_ID = "ssn-layer";
const BAR_ID = "ssn-format";
const SAVE_DELAY = 500;
const COLORS = ["yellow", "green", "blue", "pink", "white"];
// On screen, at the zoom a note is made or resized at. Stored sizes are in scene pixels.
const NEW_SIZE = { width: 300, height: 200 };
const MIN_SIZE = { width: 140, height: 80 };
const NEW_FONT = 16;
const FONT_STEP = 1.15;

// Formatting choices. Sizes are relative to the note's own text size, so the
// note's smaller/larger buttons still scale everything in it.
const TEXT_SIZES = [["SizeSmall", 0.8], ["SizeNormal", 1], ["SizeLarge", 1.35], ["SizeHuge", 1.8]];
const TEXT_COLORS = ["#2b2620", "#c0392b", "#d35400", "#2e7d32", "#1f5fbf", "#7b3fa0", "#7a7268"];
const HIGHLIGHTS = ["#fff176", "#b9f6ca", "#b3e5fc", "#f8bbd0", "#ffcc80"];
// Marks what a command just touched, so it can be rewritten: these exact values never come from a person.
const MARK_SIZE = "7";
const MARK_COLOR = "rgb(1, 2, 3)";

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

/* -------------------------------------------- */
/*  Rich text: what a note may hold              */
/* -------------------------------------------- */

// Everything that is shown or saved goes through clean(), on every client, so a
// note can't carry scripts, pictures or layout-breaking styles, whatever is pasted
// in or written into the scene's data by hand.
const KEEP_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "SPAN", "BR", "DIV", "P", "UL", "OL", "LI"]);
const BLOCK_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TABLE", "TR", "SECTION", "ARTICLE", "HEADER", "FOOTER", "DD", "DT"]);
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "IMG", "PICTURE", "VIDEO", "AUDIO", "SVG", "MATH", "TEMPLATE", "LINK", "META", "TITLE", "HEAD", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "FORM", "CANVAS", "NOSCRIPT"]);
const STYLE_PROPS = ["color", "background-color", "font-weight", "font-style", "text-decoration", "text-decoration-line", "text-align"];
const NOTE_SIZE = /^(?:var\(--ssn-font\)|calc\(var\(--ssn-font\) \* (?:\d+(?:\.\d+)?)\))$/;

function cleanStyle(el) {
  const keep = [];
  for (const prop of STYLE_PROPS) {
    const value = el.style.getPropertyValue(prop).trim();
    if (value && !/url\(|var\(|expression|image/i.test(value)) keep.push(`${prop}: ${value}`);
  }
  const size = el.style.getPropertyValue("font-size").trim();
  if (NOTE_SIZE.test(size)) keep.push(`font-size: ${size}`);
  return keep.join("; ");
}

function cleanNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE || DROP_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }
    cleanNode(child);
    let el = child;
    if (el.tagName === "FONT" || BLOCK_TAGS.has(el.tagName)) {
      const replacement = document.createElement(el.tagName === "FONT" ? "span" : "div");
      if (el.tagName === "FONT" && el.getAttribute("color")) replacement.style.color = el.getAttribute("color");
      replacement.setAttribute("style", [el.getAttribute("style"), replacement.getAttribute("style")].filter(Boolean).join(";"));
      replacement.append(...el.childNodes);
      el.replaceWith(replacement);
      el = replacement;
    }
    if (!KEEP_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const style = cleanStyle(el);
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    if (style) el.setAttribute("style", style);
  }
}

const cleaned = new Map();
function clean(html) {
  if (cleaned.has(html)) return cleaned.get(html);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  cleanNode(doc.body);
  const out = doc.body.innerHTML;
  if (cleaned.size > 200) cleaned.clear();
  cleaned.set(html, out);
  return out;
}

const textToHtml = (text) => escapeHtml(text).replace(/\n/g, "<br>");

// Notes keep their spaces and line breaks as typed, but pasted HTML is laid out for
// reading as source: its line breaks and indentation mean nothing.
function flattenSource(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.textContent = node.textContent.replace(/\s+/g, " ");
  return doc.body.innerHTML;
}

// The note's words without formatting: for its title when collapsed and the delete question.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let out = "";
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) out += child.textContent;
      else if (child.nodeName === "BR") out += "\n";
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const block = ["DIV", "P", "LI"].includes(child.nodeName);
        if (block && out && !out.endsWith("\n")) out += "\n";
        walk(child);
        if (block && !out.endsWith("\n")) out += "\n";
      }
    }
  };
  walk(doc.body);
  return out.replace(/\n+$/, "");
}

// Anything that reaches the page goes through here, so a hand-edited flag can't
// break it. Notes from 1.0.0 have only plain text, which becomes their HTML.
function normalize(note) {
  const html = typeof note.html === "string" ? clean(note.html) : textToHtml(typeof note.text === "string" ? note.text : "");
  return {
    x: number(note.x, 0),
    y: number(note.y, 0),
    width: number(note.width, NEW_SIZE.width, 20),
    height: number(note.height, NEW_SIZE.height, 20),
    html,
    text: typeof note.html === "string" ? htmlToText(html) : (typeof note.text === "string" ? note.text : ""),
    color: COLORS.includes(note.color) ? note.color : COLORS[0],
    fontSize: number(note.fontSize, NEW_FONT, 2, 800),
    collapsed: Boolean(note.collapsed),
    visible: Boolean(note.visible)
  };
}

const firstLine = (text) => text.split("\n").find((line) => line.trim())?.trim() ?? "";
const isEmpty = (el) => !el.textContent.trim() && !el.querySelector("li");

/* -------------------------------------------- */
/*  The formatting bar                           */
/* -------------------------------------------- */

// One bar for whichever note (or big editor) has the cursor. It lives outside the
// zoomed layer so it stays the same size at any zoom, and floats above the text.
class Formatter {
  static bar = null;
  static target = null;

  static button(cmd, icon, tip) {
    return `<button type="button" class="ssn-fmt" data-cmd="${cmd}" title="${escapeHtml(t(tip))}" aria-label="${escapeHtml(t(tip))}"><i class="${icon}" aria-hidden="true"></i></button>`;
  }

  static menu(name, icon, tip, items) {
    return `<span class="ssn-fmt-group">
      <button type="button" class="ssn-fmt" data-menu="${name}" title="${escapeHtml(t(tip))}" aria-label="${escapeHtml(t(tip))}" aria-haspopup="true"><i class="${icon}" aria-hidden="true"></i><i class="fa-solid fa-caret-down ssn-caret" aria-hidden="true"></i></button>
      <span class="ssn-fmt-menu" data-menu-of="${name}" hidden>${items}</span>
    </span>`;
  }

  static mount() {
    if (this.bar) return;
    const sizes = TEXT_SIZES.map(([key, scale]) => `<button type="button" class="ssn-fmt-item" data-cmd="size" data-value="${scale}" style="font-size:${Math.max(0.75, scale)}em">${escapeHtml(t(key))}</button>`).join("");
    const swatch = (cmd, color) => `<button type="button" class="ssn-fmt-swatch" data-cmd="${cmd}" data-value="${color}" style="--ssn-swatch:${color}" title="${color}" aria-label="${color}"></button>`;
    const colors = TEXT_COLORS.map((c) => swatch("color", c)).join("") + `<button type="button" class="ssn-fmt-item" data-cmd="color" data-value="">${escapeHtml(t("ColourDefault"))}</button>`;
    const highlights = HIGHLIGHTS.map((c) => swatch("highlight", c)).join("") + `<button type="button" class="ssn-fmt-item" data-cmd="highlight" data-value="">${escapeHtml(t("HighlightNone"))}</button>`;
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.setAttribute("role", "toolbar");
    bar.hidden = true;
    bar.innerHTML = [
      this.button("bold", "fa-solid fa-bold", "Bold"),
      this.button("italic", "fa-solid fa-italic", "Italic"),
      this.button("underline", "fa-solid fa-underline", "Underline"),
      this.button("strikeThrough", "fa-solid fa-strikethrough", "Strikethrough"),
      `<span class="ssn-fmt-sep"></span>`,
      this.menu("size", "fa-solid fa-text-height", "TextSize", sizes),
      this.menu("color", "fa-solid fa-font", "TextColour", colors),
      this.menu("highlight", "fa-solid fa-highlighter", "Highlight", highlights),
      `<span class="ssn-fmt-sep"></span>`,
      this.button("insertUnorderedList", "fa-solid fa-list-ul", "BulletList"),
      this.button("insertOrderedList", "fa-solid fa-list-ol", "NumberedList"),
      `<span class="ssn-fmt-sep"></span>`,
      this.button("removeFormat", "fa-solid fa-eraser", "ClearFormatting")
    ].join("");
    // Pressing a button mustn't take the cursor out of the text, or there'd be nothing to format.
    bar.addEventListener("pointerdown", (event) => event.preventDefault());
    bar.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.menu) return this.toggleMenu(button.dataset.menu);
      this.closeMenus();
      this.run(button.dataset.cmd, button.dataset.value);
    });
    document.body.append(bar);
    this.bar = bar;
  }

  static attach(el) {
    this.mount();
    this.target = el;
    this.closeMenus();
    this.bar.hidden = false;
    this.position();
    this.refresh();
  }

  static detach(el) {
    if (this.target !== el) return;
    this.target = null;
    if (this.bar) this.bar.hidden = true;
    this.closeMenus();
  }

  // Above the text box, or below it when there's no room, and always on screen.
  static position() {
    const el = this.target;
    if (!el || !this.bar) return;
    if (!el.isConnected) return this.detach(el);
    const box = (el.closest(".ssn-note") ?? el).getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = this.bar;
    let top = box.top - h - 6;
    if (top < 4) top = Math.min(box.bottom + 6, window.innerHeight - h - 4);
    const left = Math.min(Math.max(4, box.left), Math.max(4, window.innerWidth - w - 4));
    this.bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  static refresh() {
    if (!this.target || !this.bar) return;
    for (const cmd of ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"]) {
      let on = false;
      try {
        on = document.queryCommandState(cmd);
      } catch (_error) {
        // Not supported: shown as off.
      }
      this.bar.querySelector(`[data-cmd="${cmd}"]`)?.classList.toggle("is-on", on);
    }
  }

  static toggleMenu(name) {
    for (const menu of this.bar.querySelectorAll(".ssn-fmt-menu")) {
      menu.hidden = menu.dataset.menuOf === name ? !menu.hidden : true;
    }
  }

  static closeMenus() {
    for (const menu of this.bar?.querySelectorAll(".ssn-fmt-menu") ?? []) menu.hidden = true;
  }

  static exec(cmd, value = null) {
    document.execCommand("styleWithCSS", false, true);
    return document.execCommand(cmd, false, value);
  }

  // Runs a formatting command on the selection. Sizes and "no colour" have no
  // command of their own: a marker value is applied, then rewritten.
  static run(cmd, value) {
    const el = this.target;
    if (!el) return;
    el.focus();
    if (cmd === "size") {
      this.exec("fontSize", MARK_SIZE);
      const scale = Number(value);
      this.rewrite(el, (node) => node.tagName === "FONT" ? node.getAttribute("size") === MARK_SIZE : node.style.fontSize === "xxx-large", (node) => {
        for (const inner of node.querySelectorAll("[style]")) inner.style.removeProperty("font-size");
        node.style.fontSize = scale === 1 ? "" : `calc(var(--ssn-font) * ${scale})`;
      });
    } else if (cmd === "color" || cmd === "highlight") {
      const prop = cmd === "color" ? "color" : "background-color";
      this.exec(cmd === "color" ? "foreColor" : "hiliteColor", value || MARK_COLOR);
      if (!value) {
        this.rewrite(el, (node) => node.style.getPropertyValue(prop) === MARK_COLOR || (node.tagName === "FONT" && node.getAttribute("color") === "#010203"), (node) => {
          for (const inner of node.querySelectorAll("[style]")) inner.style.removeProperty(prop);
          node.style.removeProperty(prop);
          node.removeAttribute("color");
        });
      }
    } else {
      this.exec(cmd);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    this.refresh();
  }

  // Turns marked <font> elements into spans, applies the change, and unwraps spans
  // left with no style at all.
  static rewrite(root, isMarked, change) {
    for (const node of [...root.querySelectorAll("font, span")]) {
      if (!isMarked(node)) continue;
      let el = node;
      if (el.tagName === "FONT") {
        const span = document.createElement("span");
        span.setAttribute("style", el.getAttribute("style") ?? "");
        if (el.getAttribute("color") && el.getAttribute("color") !== "#010203") span.style.color = el.getAttribute("color");
        span.append(...el.childNodes);
        el.replaceWith(span);
        el = span;
      }
      change(el);
      if (!el.getAttribute("style")?.trim()) el.replaceWith(...el.childNodes);
    }
    // Unwrapping leaves a line in pieces; the next command should see it whole.
    root.normalize();
  }
}

// Every rich text box (notes and the big editor) is handled from here, so the big
// editor needs no hooks into the dialog.
document.addEventListener("focusin", (event) => {
  const el = event.target.closest?.(".ssn-rich");
  if (el) Formatter.attach(el);
});
document.addEventListener("focusout", (event) => {
  const el = event.target.closest?.(".ssn-rich");
  if (el) Formatter.detach(el);
});
document.addEventListener("selectionchange", () => Formatter.refresh());
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest?.(`#${BAR_ID}`)) Formatter.closeMenus();
});

function setupRich(el) {
  // Keys typed into a note are for the note, not for Foundry's shortcuts.
  el.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") el.blur();
  });
  // Pasted text keeps bold, italics, colours and lists, nothing else.
  el.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    const html = data.getData("text/html");
    if (html) document.execCommand("insertHTML", false, flattenSource(clean(html)));
    else document.execCommand("insertText", false, data.getData("text/plain"));
  });
  // Ctrl+B and the like change the style without moving the selection.
  el.addEventListener("input", () => {
    el.classList.toggle("is-empty", isEmpty(el));
    Formatter.refresh();
  });
}

/* -------------------------------------------- */
/*  The notes                                    */
/* -------------------------------------------- */

class StickyNotes {
  static layer = null;
  static board = null;
  static offset = { left: 0, top: 0 };
  static matrix = "";
  static scale = 1;
  static elements = new Map();
  static applied = new Map();
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
    this.applied.clear();
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
    if (css !== this.matrix) {
      this.matrix = css;
      this.scale = Math.hypot(m.a, m.b) || 1;
      this.layer.style.transform = css;
    }
    Formatter.position();
  }

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
      this.applied.delete(id);
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
      <div class="ssn-text"></div>
      ${gm ? `<div class="ssn-resize"></div>` : ""}`;

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

    const text = el.querySelector(".ssn-text");
    text.classList.add("ssn-rich");
    text.contentEditable = "true";
    text.spellcheck = true;
    text.dataset.placeholder = t("Placeholder");
    setupRich(text);
    text.addEventListener("input", () => this.schedule(id, text));
    text.addEventListener("blur", () => this.flush(id));
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

    // What's being typed wins over what was saved a moment ago.
    const text = el.querySelector(".ssn-text");
    const editing = document.activeElement === text || this.pending.has(id);
    if (!editing && this.applied.get(id) !== note.html) {
      text.innerHTML = note.html;
      this.applied.set(id, note.html);
      text.classList.toggle("is-empty", isEmpty(text));
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
  static schedule(id, editor) {
    const entry = this.pending.get(id);
    if (entry) clearTimeout(entry.timer);
    const scene = entry?.scene ?? this.scene;
    const timer = setTimeout(() => this.flush(id), SAVE_DELAY);
    this.pending.set(id, { scene, editor, timer });
  }

  static flush(id) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    // The note already shows this text, so the save mustn't redraw it under the cursor.
    if (entry.scene === this.scene) this.applied.set(id, clean(entry.editor.innerHTML));
    this.saveHtml(entry.scene, id, entry.editor.innerHTML);
  }

  static saveHtml(scene, id, html) {
    const value = clean(html);
    const raw = this.notes(scene)[id];
    if (!raw || (typeof raw.html === "string" && clean(raw.html) === value)) return;
    return this.save(scene, id, { html: value, text: htmlToText(value) });
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
      html: "",
      text: "",
      color: COLORS[0],
      fontSize: Math.round(NEW_FONT / scale),
      collapsed: false,
      visible: false
    });
    const el = this.elements.get(id);
    if (!el) return;
    el.style.zIndex = String(++this.top);
    el.querySelector(".ssn-rich")?.focus();
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

  // For long texts: the same text in a big window that can be resized, with the same formatting bar.
  static async openEditor(scene, id) {
    this.flush(id);
    const current = normalize(this.notes(scene)[id] ?? {});
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: firstLine(current.text) || t("EditorTitle"), resizable: true },
      position: { width: 640, height: 520 },
      classes: ["ssn-editor"],
      content: `<div class="ssn-rich ssn-editor-body${current.text.trim() ? "" : " is-empty"}" contenteditable="true" spellcheck="true" data-placeholder="${escapeHtml(t("Placeholder"))}" style="--ssn-font: 16px">${current.html}</div>`,
      ok: {
        icon: "fa-solid fa-check",
        label: t("Save"),
        callback: (_event, button, dialog) => (button?.form ?? dialog?.element)?.querySelector?.(".ssn-editor-body")?.innerHTML
      },
      rejectClose: false
    });
    if (typeof result === "string") await this.saveHtml(scene, id, result);
  }
}

// The big editor's text box is created by the dialog, so it's set up the first time it gets the cursor.
document.addEventListener("focusin", (event) => {
  const el = event.target.closest?.(".ssn-editor-body");
  if (el && !el.dataset.ssnReady) {
    el.dataset.ssnReady = "1";
    setupRich(el);
  }
}, true);

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

# Scene Sticky Notes

A Foundry VTT module that puts sticky notes for the GM right on the scene. You see a note's whole text and type straight onto it, with bold, italics, sizes, colours and lists, and you can move it and resize it with the text reflowing to fit. Notes stay pinned to their spot on the map when you pan and zoom.

It replaces nothing: Foundry's own Map Notes keep working as before.

## Install

In Foundry: **Add-on Modules → Install Module**, paste this manifest URL and click **Install**:

```
https://github.com/FruityOwl/scene-sticky-notes/releases/latest/download/module.json
```

Then enable **Scene Sticky Notes** in your world's **Manage Modules**.

## Using it

- **New note:** open the **Notes** controls on the left and click **New sticky note**. It appears in the middle of the screen, ready to type in.
- **Typing:** click into a note and type, like in a messenger: several lines, the text wraps, the cursor moves freely, Ctrl+Z undoes. It saves half a second after you stop typing. Esc leaves the note.
- **Formatting:** while you type, a bar appears above the note. Select some text and use it, as in Word:
  - bold, italic, underline and strikethrough (also Ctrl+B, Ctrl+I, Ctrl+U)
  - text size: small, normal, large or huge
  - text colour, and a highlight behind the text
  - bulleted and numbered lists
  - clear formatting

  The bar keeps the same size however far you zoom out. Text pasted from elsewhere keeps its bold, italics, colours and lists; pictures, fonts and links are left out.
- **Moving:** drag the coloured strip at the top.
- **Resizing:** drag the bottom-right corner. The text reflows as you drag.
- **The buttons** appear on the strip when you point at a note:
  - colour, which cycles through yellow, green, blue, pink and white
  - smaller and larger text for the whole note (sizes chosen in the bar grow and shrink with it)
  - the eye, which shows the note to players or hides it again
  - a large editor window for long texts, with the same formatting bar
  - collapse to just the strip (double-clicking the strip does the same)
  - delete, which asks first unless the note is empty

## Who sees what

- Only GMs can create, edit, move or delete notes.
- A new note is for GMs only. Click the eye to show it to players. Players see it on the scene but can't change it, and the strip shows a small eye on notes they can see.
- Changes reach everyone connected straight away, with no reload.

Hidden notes are kept from players' screens, not from their computers: a note's text is stored with the scene, which every player's browser downloads. Someone digging through the browser's developer tools could read it, so this isn't a place for secrets that must never leak.

## How it's stored

Each scene keeps its notes in its own data (`flags.scene-sticky-notes.notes`), so they're copied, exported and deleted along with the scene. Positions and sizes are in scene pixels, which is why a note stays on the same part of the map at any zoom.

A note's text is stored as HTML. Every client cleans it before showing it, keeping only formatting (bold, italics, underline, strikethrough, sizes, colours, highlights, lists and line breaks), so nothing written into a note can run code or break the page. Notes made with 1.0.0 keep their text and gain formatting once edited.

## Compatibility

Foundry VTT 14. No other modules needed. English and Russian.

## Releasing a new version

Bump `version` in `module.json` and push to `main`. The GitHub Action builds `module.zip` and publishes a release; Foundry then offers the update. Everyone should press Ctrl+F5 after updating.

## License

MIT. See [LICENSE](LICENSE).

# Scene Sticky Notes

A Foundry VTT module that puts sticky notes for the GM right on the scene. You see a note's whole text and type straight onto it, and you can move it and resize it with the text reflowing to fit. Notes stay pinned to their spot on the map when you pan and zoom.

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
- **Moving:** drag the coloured strip at the top.
- **Resizing:** drag the bottom-right corner. The text reflows as you drag.
- **The buttons** appear on the strip when you point at a note:
  - colour, which cycles through yellow, green, blue, pink and white
  - smaller and larger text
  - the eye, which shows the note to players or hides it again
  - a large editor window for long texts
  - collapse to just the strip (double-clicking the strip does the same)
  - delete, which asks first unless the note is empty

## Who sees what

- Only GMs can create, edit, move or delete notes.
- A new note is for GMs only. Click the eye to show it to players. Players see it on the scene but can't change it, and the strip shows a small eye on notes they can see.
- Changes reach everyone connected straight away, with no reload.

Hidden notes are kept from players' screens, not from their computers: a note's text is stored with the scene, which every player's browser downloads. Someone digging through the browser's developer tools could read it, so this isn't a place for secrets that must never leak.

## How it's stored

Each scene keeps its notes in its own data (`flags.scene-sticky-notes.notes`), so they're copied, exported and deleted along with the scene. Positions and sizes are in scene pixels, which is why a note stays on the same part of the map at any zoom.

## Compatibility

Foundry VTT 14. No other modules needed. English and Russian.

## Releasing a new version

Bump `version` in `module.json` and push to `main`. The GitHub Action builds `module.zip` and publishes a release; Foundry then offers the update. Everyone should press Ctrl+F5 after updating.

## License

MIT. See [LICENSE](LICENSE).

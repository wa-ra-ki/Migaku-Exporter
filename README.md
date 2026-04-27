# Migaku → Anki Exporter

A Tampermonkey/Violentmonkey userscript that exports decks from Migaku (https://study.migaku.com) to Anki `.apkg` files.

---

## ⚠️ Attribution

The **Migaku → Anki Exporter** was originally created by **SirOlaf**.  
Original repository: https://github.com/SirOlaf/migaku-anki-exporter/

---

## Features

- 🔗 **Integrated into the Memory + menu** — click **+** → **Export to Anki**, no separate FAB needed.
- 🔎 **Searchable deck dropdown** — filter by language, scroll through 50+ decks.
- 📦 **Multi-deck export**:
  - Export each deck separately as `.apkg`.
  - Or merge multiple decks into one `.apkg`.
- 🎯 **Simplified & Advanced modes**:
  - **Simple mode** → quick presets (smaller, normal, better quality).
  - **Advanced mode** → full control of media conversion, dimensions, sample rates.
- 🖼️ **Media options**:
  - Toggle image/audio export independently.
  - Auto-resize/compress images and audio to reduce package size.
- 📝 **Anki field mapping** — popup editor for customising exported field names.
- 🧩 **Built-in Anki model templates** for Migaku card types (with fallback).
- 📊 **Progress bar + status display** for every export step.
- 📑 **Wordlist export** — export known/learning/ignored words as CSV inside `.zip`.
- 💾 **IndexedDB media cache** — prevents redundant downloads across exports.
- ⚡ **Background SQL.js pre-load** — WASM is fetched on page load so the modal opens instantly.
- 🎓 **Interactive tutorial** — step-by-step onboarding for new users.

---

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge) or [Violentmonkey](https://violentmonkey.github.io/) (Firefox/Chromium).
2. Add the userscript:
   - Copy the contents of `Javascript.js` into a new userscript in your manager.
3. Visit `https://study.migaku.com/` and wait for the site to fully load.

---

## How to use

### Exporting Decks
1. Click the **+** button (bottom-right on the Memory page).
2. Select **Export to Anki**.
3. Pick your decks from the searchable dropdown (filter by language if needed).
4. Choose options — simplified presets or switch to Advanced mode.
5. Click **Export selected decks**.
   - One `.apkg` per deck, or enable **Merge decks** for a single combined file.
6. (Optional) Click **Export wordlists** to download known/learning words as CSVs in a `.zip`.


---

## Development / Contributing

- Uses `sql.js` (v1.13) to parse Migaku's compressed SQLite deck blobs from IndexedDB.
- Media fetched from Migaku's sync worker using a Firebase bearer token.
- Anki card models defined in-script with auto-generated templates per card type.
- SQL.js WASM is pre-fetched at `document-idle` so it's resolved before first user interaction.

### Future ideas
- Frequency-based word sorting
- One-click cache clearing in UI
- More export presets (e.g. "Study-ready")

---

## FAQ

**Q: Where's the Export to Anki button?**  
A: Click the **+** button on the Memory page → **Export to Anki**.

**Q: Can I disable images or audio?**  
A: Yes — click **Include media ▾** to toggle images and audio independently.

**Q: Can I merge decks into one file?**  
A: Yes — enable the **Merge decks** toggle before exporting.

**Q: Where are my exports saved?**  
A: In your browser's default downloads folder.

**Q: Can I customise the Anki field names?**  
A: Yes — switch to **Advanced** mode and click **Open Field Mapping**.

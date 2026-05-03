# Migaku → Anki Exporter

A Tampermonkey/Violentmonkey userscript that exports decks from Migaku (https://study.migaku.com) to Anki `.apkg` files, or sends cards **directly to Anki** via AnkiConnect.

> **This is a fork by [marlanbar](https://github.com/marlanbar/Migaku-Exporter)** adding AnkiConnect integration on top of the original work.

---

## ⚠️ Attribution

The **Migaku → Anki Exporter** was originally created by **SirOlaf**.  
Original repository: https://github.com/SirOlaf/migaku-anki-exporter/

Forked and extended by **wa-ra-ki**: https://github.com/wa-ra-ki/Migaku-Exporter  
Further extended by **marlanbar**: https://github.com/marlanbar/Migaku-Exporter

---

## Features

- 🔗 **Persistent FAB button** — a blue Anki icon button is always visible on every page of study.migaku.com. Click it to open the exporter.
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
- 🃏 **AnkiConnect direct push** *(new)* — send cards straight to a running Anki desktop app without downloading an `.apkg` file.

---

## AnkiConnect Integration (new)

Requires [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on installed in Anki.

### Setup
1. Open Anki and make sure AnkiConnect is running (default port 8765).
2. Open the exporter modal (click the blue Anki FAB).
3. In the **Anki Target** section, click **Connect to Anki**.
4. Select your **target deck** and **note type** from the dropdowns.
5. Click **Map Fields** to map each Anki note field to the corresponding Migaku field.
6. Save the mapping — it persists in `localStorage` across sessions.

### Exporting directly to Anki
- Select your Migaku decks as usual.
- Click **Export selected decks** — if a target deck is configured, cards are sent directly to Anki instead of downloading an `.apkg`.
- Duplicate cards (matched by first field within the deck) are automatically skipped.

---

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge) or [Violentmonkey](https://violentmonkey.github.io/) (Firefox/Chromium).
2. Add the userscript:
   - Copy the contents of `Javascript.js` into a new userscript in your manager.
3. Visit `https://study.migaku.com/` and wait for the site to fully load.

---

## How to use

### Exporting as .apkg
1. Click the blue **Anki icon** button (bottom-right, visible on all pages).
2. Pick your decks from the searchable dropdown (filter by language if needed).
3. Choose options — simplified presets or switch to Advanced mode.
4. Click **Export selected decks**.
   - One `.apkg` per deck, or enable **Merge decks** for a single combined file.
5. (Optional) Click **Export wordlists** to download known/learning words as CSVs in a `.zip`.

### Sending directly to Anki
1. Follow the **AnkiConnect Setup** steps above.
2. Select decks and click **Export selected decks** — cards go straight to Anki.

---

## Development / Contributing

- Uses `sql.js` (v1.13) to parse Migaku's compressed SQLite deck blobs from IndexedDB.
- Media fetched from Migaku's sync worker using a Firebase bearer token.
- Anki card models defined in-script with auto-generated templates per card type.
- SQL.js WASM is pre-fetched at `document-idle` so it's resolved before first user interaction.
- AnkiConnect requests use `GM_xmlhttpRequest` (with `fetch` fallback) to bypass CORS.

### Future ideas
- Frequency-based word sorting
- One-click cache clearing in UI
- More export presets (e.g. "Study-ready")

---

## FAQ

**Q: Where's the Export to Anki button?**  
A: A blue Anki icon button is always visible in the bottom-right corner on every page.

**Q: Can I disable images or audio?**  
A: Yes — click **Include media ▾** to toggle images and audio independently.

**Q: Can I merge decks into one file?**  
A: Yes — enable the **Merge decks** toggle before exporting.

**Q: Where are my exports saved?**  
A: In your browser's default downloads folder (for `.apkg`), or directly in Anki (if AnkiConnect is configured).

**Q: Can I customise the Anki field names?**  
A: Yes — switch to **Advanced** mode and click **Open Field Mapping** (for `.apkg`), or use **Map Fields** next to the note type (for AnkiConnect).

**Q: Will it add duplicate cards?**  
A: No — when sending via AnkiConnect, duplicates within the target deck are automatically skipped.

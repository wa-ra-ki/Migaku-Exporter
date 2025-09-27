# Migaku → Anki Exporter + MigakuGPT

A Tampermonkey/Violentmonkey userscript that exports decks from Migaku (https://study.migaku.com) to Anki `.apkg` files, and adds an integrated **MigakuGPT assistant** with chat, study analytics, and video embedding.  

---

## ⚠️ Attribution

The **Migaku → Anki Exporter** was originally created by **SirOlaf**.  
Original repository: https://github.com/SirOlaf/migaku-anki-exporter/

This fork builds on SirOlaf’s work with:
- Redesigned glassmorphic UI  
- Multi-deck export + merging  
- Media handling presets  
- Field mapping UI  
- **MigakuGPT integration** with chat, quick actions, and video previews  

---

## Features

- ✨ **Glassmorphic UI** with modern animations, dropdowns, styled checkboxes/sliders.  
- 🟣 **Floating Action Button (FAB)** in bottom-left corner with presets + exporter menu.  
- 🔎 **Searchable deck dropdown** — filter and scroll, handles 50+ decks.  
- 📦 **Multi-deck export**:
  - Export each deck separately as `.apkg`.  
  - Or merge multiple decks into one `.apkg`.  
- 🎨 **Simplified & Advanced modes**:
  - **Simplified mode** → quick presets (small, normal, better quality).  
  - **Advanced mode** → full control of media conversion and formats.  
- 🖼️ **Media options**:
  - Toggle image/audio export.  
  - Auto-resize/compress media to reduce package size.  
- 📝 **Anki field mapping** — clean popup editor for customizing exported field names.  
- 🧩 **Built-in Anki model templates** for Migaku card types (with fallback).  
- 📊 **Progress bar + status display** for export steps.  
- 📑 **Wordlist export** → export known/learning words as CSV inside `.zip`.  
- 💾 **IndexedDB caching** — prevents redundant media downloads.  
- 🚀 **SQL.js initialization** with ArrayBuffer fallback (fixes streaming errors).  
- 🤖 **MigakuGPT Assistant**:
  - Chat window with draggable/resizable UI.  
  - Save your OpenAI API key locally to enable GPT-powered study help.  
  - Quick actions for study plans, grammar videos, learning stats.  
  - Automatic embedding of YouTube links with previews.  
  - Rich-text, code formatting, and link previews in chat.  

---

## Installation

1. Install Tampermonkey (Chrome/Edge) or Violentmonkey (Firefox/Chromium).  
2. Add the userscript:  
   - **Option A** — copy the file `Javascript.js` into a new userscript in your manager.  
   - **Option B** — open `Javascript.js` in your manager, save, and enable it.  
3. Visit `https://study.migaku.com/` and wait for the site to fully load.  

---

## How to use

### Exporting Decks
1. Click the **+** button (bottom-left).  
2. Select **Migaku Exporter**.  
3. Pick your decks from the searchable dropdown.  
4. Choose options (simplified presets or advanced mode).  
5. Click **Export selected decks**.  
   - One `.apkg` per deck (or merged into one).  
6. (Optional) **Export wordlists** as CSVs in `.zip`.  

### Using MigakuGPT
1. Open the FAB menu → select **MigakuGPT**.  
2. Enter your **OpenAI API key** when prompted (stored locally only).  
3. Start chatting:
   - Ask for study plans, deck analysis, video resources, grammar help, etc.  
   - Click quick action buttons for common tasks.  
   - Links auto-expand into previews, YouTube links show video cards.  

---

## Troubleshooting

### `wasm streaming compile failed: Incorrect response MIME type`
Expected fallback — script loads via ArrayBuffer. Update userscript manager if needed.

### Media fetch errors (401/403)
- Make sure you’re logged into Migaku and the site is fully loaded.  
- If tokens expire, log out and back into Migaku.  

### Export takes too long
Use smaller presets to reduce file size when exporting large decks.  

### MigakuGPT not working
- Ensure you saved a valid OpenAI API key (starts with `sk-`).  
- Check browser console for logs.  

### Clear media cache
1. Open DevTools → Application → IndexedDB.  
2. Delete database `unofficialmgkexporterMediaDb`.  

---

## Development / Contributing

- Uses `sql.js` (v1.13) to parse Migaku SQLite deck blobs.  
- Media fetched from Migaku sync worker using Firebase bearer token.  
- Anki card models defined in script with fallback templates.  
- MigakuGPT powered by OpenAI API + custom UI for video/link previews.  

### Future ideas
- Frequency-based word sorting.  
- More export presets (e.g., “Study-ready”).  
- One-click cache clearing in UI.  

---

## FAQ

**Q: Where’s the exporter button?**  
A: Bottom-left **+** → **Migaku Exporter**.  

**Q: Can I disable images or audio?**  
A: Yes, toggle them individually in the UI.  

**Q: Can I merge decks?**  
A: Yes, either export separately or merge them.  

**Q: Where are my exports saved?**  
A: In your browser’s downloads folder.  

**Q: Where’s MigakuGPT?**  
A: Bottom-left **+** → **MigakuGPT**.  

---

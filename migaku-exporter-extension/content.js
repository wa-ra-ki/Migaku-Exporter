// Migaku Exporter - Chrome Extension (MV3) content script
// Converted from Tampermonkey userscript by port-plan.md

// setImmediate polyfill (was provided via @require in userscript)
globalThis.setImmediate = setTimeout;

// ExtensionFetch - proxies cross-origin requests through the service worker
const ExtensionFetch = {
  json: (url, options = {}) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "fetch", url, options },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error("No response from service worker"));
            return;
          }
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response);
        }
      );
    });
  },

  blob: (url, options = {}) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "fetchBlob", url, options },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error("No response from service worker"));
            return;
          }
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          if (!response.ok || !response.blobBase64) {
            resolve(null);
            return;
          }
          // Convert base64 back to Blob
          const binary = atob(response.blobBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          resolve(new Blob([bytes], { type: response.contentType }));
        }
      );
    });
  }
};

const CONFIG = {
  STATUS_ELEMENT_ID: "mgkexporterStatusMessage",
  MEDIA_STORE_NAME: "mediacache",
  FAB_ID: "mgkFab",
  MODAL_ID: "mgkExportUI",
  CHAT_MODAL_ID: "mgkChatModal",
  MAPPING_MODAL_ID: "mgkMapModal",
  HIDDEN_SELECTION_ID: "mgkDeckSelectHidden",
  MAPPING_STORAGE_KEY: "migaku_to_anki_mappings",
  SETTINGS_STORAGE_KEY: "migaku_exporter_settings",
  CHAT_API_KEY_STORAGE: "migaku_gpt_api_key",

  MIGAKU_FIELDS: [
    'Word', 'Sentence', 'Translated Sentence', 'Definitions',
    'Example Sentences', 'Notes', 'Images', 'Sentence Audio', 'Word Audio'
  ],

  FORBIDDEN_PATTERNS: /\b(migaku|academy|fundamentals|course|lesson)\b/i,

  PRESETS: {
    "smaller": {
      imageMaxDimension: 800, imageQuality: 0.7, audioSampleRate: 16000,
      maxMediaSizeMB: 3, enableImageConversion: true, enableAudioConversion: true,
      label: "Smaller file size"
    },
    "normal": {
      imageMaxDimension: 1024, imageQuality: 0.85, audioSampleRate: 22050,
      maxMediaSizeMB: 10, enableImageConversion: true, enableAudioConversion: true,
      label: "Normal"
    },
    "better": {
      imageMaxDimension: 2048, imageQuality: 0.95, audioSampleRate: 44100,
      maxMediaSizeMB: 50, enableImageConversion: false, enableAudioConversion: false,
      label: "Better quality"
    }
  }
};

const Utils = {
  log: (...args) => console.log("[Migaku Export]", ...args),

  setStatus: (text, color = "") => {
    try {
      const el = document.getElementById(CONFIG.STATUS_ELEMENT_ID);
      if (el) {
        el.innerText = text;
        if(color) el.style.color = color;
      }
      Utils.log(text);
    } catch (error) {
      // element might not be in DOM yet, happens sometimes on initial load
      console.warn("[MGK] setStatus failed:", error);
    }
  },

  safeGetElement: (id) => {
    try {
      return document.getElementById(id);
    } catch (error) {
      console.warn(`[MGK] Element not found: ${id}`);
      return null;
    }
  },

  safeAddListener: (elOrSelector, eventName, handler, options = {}) => {
    try {
      if (!elOrSelector) return;
      let el = elOrSelector;
      if(typeof el === "string") el = document.querySelector(el);
      if (!el) return;

      if(typeof el.addEventListener === "function") {
        el.addEventListener(eventName, handler, options);
      } else if(typeof el.onclick === "undefined" && eventName === "click"){
        // fallback for older browsers
        el.onclick = handler;
      }
    } catch (e) {
      console.warn("[MGK] safeAddListener failed", e);
    }
  },

  // https://stackoverflow.com/a/2117523
  createUUID: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  formatBytes: (bytes) => {
    if(bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
};


const Storage = {
  saveSettings: (obj) => {
    try {
      let current = JSON.parse(localStorage.getItem(CONFIG.SETTINGS_STORAGE_KEY) || "{}");
      let merged = { ...current, ...obj };
      localStorage.setItem(CONFIG.SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    } catch (error) {
      console.warn("[MGK] Failed to save settings:", error);
    }
  },

  loadSettings: () => {
    return JSON.parse(localStorage.getItem(CONFIG.SETTINGS_STORAGE_KEY) || "{}");
  },

  saveMappings: (map) => {
    localStorage.setItem(CONFIG.MAPPING_STORAGE_KEY, JSON.stringify(map || {}));
  },

  loadMappings: () => {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.MAPPING_STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  },

  saveApiKey: (key) => {
    localStorage.setItem(CONFIG.CHAT_API_KEY_STORAGE, key);
  },

  loadApiKey: () => {
    return localStorage.getItem(CONFIG.CHAT_API_KEY_STORAGE) || "";
  }
};

// Progress UI
const Progress = {
  ensureUI: () => {
    if(document.getElementById("mgkProgressContainer")) return;
    const container = Utils.safeGetElement(CONFIG.MODAL_ID)?.querySelector(".mgk-controls");
    if(!container) return;

    const wrap = document.createElement("div");
    wrap.id = "mgkProgressContainer";
    wrap.style.marginTop = "14px";
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div id="mgkProgressLabel" style="font-size:0.95rem;color:rgba(255,255,255,0.75)">Idle</div>
        <div id="mgkProgressPercent" style="font-size:0.95rem;color:rgba(255,255,255,0.75)">0%</div>
      </div>
      <div style="height:12px;background:rgba(255,255,255,0.1);border-radius:999px;overflow:hidden;backdrop-filter:blur(10px)">
        <div id="mgkProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#4f46e5,#06b6d4);transition:width 260ms ease;border-radius:inherit;"></div>
      </div>
    `;
    container.appendChild(wrap);
  },

  show: (label = "Starting...", percent = 0) => {
    Progress.ensureUI();
    var container = Utils.safeGetElement("mgkProgressContainer");
    if(container) container.style.display = "block";
    Progress.set(percent, label);
  },

  hide: () => {
    var container = Utils.safeGetElement("mgkProgressContainer");
    if(container) container.style.display = "none";
    Progress.set(0, "Idle");
  },

  set: (percent = 0, label = "") => {
    Progress.ensureUI();
    var bar = Utils.safeGetElement("mgkProgressBar");
    var labelEl = Utils.safeGetElement("mgkProgressLabel");
    var pctEl = Utils.safeGetElement("mgkProgressPercent");

    if(bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if(labelEl) labelEl.innerText = label || "";
    if(pctEl) pctEl.innerText = `${Math.round(percent)}%`;
    if(label) Utils.setStatus(label);
  }
};

// media processing functions
const MediaProcessor = {
  // decompress gzip - needed for migaku's db format
  async decompressBlobGzip(blob) {
    const ds = new DecompressionStream("gzip");
    const decompressedStream = blob.stream().pipeThrough(ds);
    const reader = decompressedStream.getReader();
    let chunks = [];
    let totalSize = 0;

    while(true) {
      const { value, done } = await reader.read();
      if(done) break;
      chunks.push(value);
      totalSize += value.byteLength;
    }

    let out = new Uint8Array(totalSize);
    let offset = 0;
    for(const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  },

  imageResizeToBlob(imgBlob, maxDim = 1024, quality = 0.85) {
    return new Promise((resolve) => {
      var img = new Image();
      img.onload = async () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);

        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(imgBlob);
    });
  },

  async decodeAudioBlobToBuffer(blob) {
    try {
      var arrayBuffer = await blob.arrayBuffer();
      var ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
      return await ctx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.warn("Audio decode failed", e);
      throw e;
    }
  }
};

// firebase auth to get media from migaku's servers
const FirebaseAuth = {
  getFirebaseLocalStorageRows() {
    return new Promise(resolve => {
      var req = indexedDB.open("firebaseLocalStorageDb", 1);
      req.onsuccess = () => {
        var idb = req.result;
        var tx = idb.transaction("firebaseLocalStorage", "readonly");
        var store = tx.objectStore("firebaseLocalStorage");
        store.getAll().onsuccess = ev => resolve(ev.target.result);
        idb.close();
      };
      req.onerror = () => resolve([]);
    });
  },

  async exchangeRefreshToken(apiKey, refreshToken) {
    const url = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;
    const resp = await ExtensionFetch.json(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }).toString()
    });
    return resp.data;
  },

  async getAccessToken() {
    var rows = await FirebaseAuth.getFirebaseLocalStorageRows();
    if(!rows || rows.length === 0) {
      throw new Error("Firebase info missing (can't fetch media).");
    }

    var info = rows[0].value;
    var tokenResp = await FirebaseAuth.exchangeRefreshToken(
      info.apiKey,
      info.stsTokenManager.refreshToken
    );
    var expiresAt = Date.now() + (Number(tokenResp.expires_in) - 5) * 1000;
    return { token: tokenResp.access_token, expiresAt };
  }
};

// database query helpers
const DatabaseOps = {
  // load and decompress the srs database from indexeddb
  loadRawSrsDatabaseBlob() {
    return new Promise((resolve) => {
      var dbRequest = indexedDB.open("srs", 1);
      dbRequest.onsuccess = function() {
        var idb = dbRequest.result;
        var transaction = idb.transaction("data", "readonly");
        var objectStore = transaction.objectStore("data");
        var cursorRequest = objectStore.openCursor();

        cursorRequest.onsuccess = async function() {
          var cursor = cursorRequest.result;
          if(cursor) {
            try {
              var data = cursor.value.data;
              var blob = new Blob([data], { type: "application/octet-stream" });
              var decompressed = await MediaProcessor.decompressBlobGzip(blob);
              resolve(decompressed);
            } catch (err) {
              console.error("Error decompressing srs DB blob:", err);
              resolve(null);
            }
          } else {
            resolve(null);
          }
          try { idb.close(); } catch (e) {}
        };
        cursorRequest.onerror = function() {
          resolve(null);
          try { idb.close(); } catch (e) {}
        };
      };
      dbRequest.onerror = function () { resolve(null); };
    });
  },

  rowArrayToObject(columnNames, rowVals) {
    const row = {};
    for (let i = 0; i < columnNames.length; i++) {
      const col = columnNames[i];
      row[col] = (col === "del") ? (rowVals[i] !== 0) : rowVals[i];
    }
    return row;
  },

  sqlExecToObjects(result) {
    if (!result) return [];
    var res = [];
    for (const val of result.values) {
      res.push(DatabaseOps.rowArrayToObject(result.columns, val));
    }
    return res;
  },

  runQueryToObjects(db, query, params) {
    try {
      var result = db.exec(query, params)[0];
      return DatabaseOps.sqlExecToObjects(result);
    } catch (e) {
      return [];
    }
  },

  listDecks(db) {
    return DatabaseOps.runQueryToObjects(db, "SELECT id, lang, name, del FROM deck;");
  },

  listCardsForDeck(db, deckId) {
    return DatabaseOps.runQueryToObjects(db,
      "SELECT id, mod, del, cardTypeId, created, primaryField, secondaryField, fields, words, due, interval, factor, lastReview, reviewCount, passCount, failCount, suspended FROM card WHERE deckId=?",
      [deckId]
    );
  },

  listReviewHistory(db) {
    return DatabaseOps.runQueryToObjects(db,
      "SELECT id, mod, del, day, interval, factor, cardId, duration, type, lapseIndex FROM review"
    );
  },

  listWordListForLanguage(db, lang) {
    return DatabaseOps.runQueryToObjects(db,
      "SELECT dictForm, secondary, partOfSpeech, language, mod, serverMod, del, knownStatus, hasCard, tracked FROM WordList WHERE language=?",
      [lang]
    );
  },

  readCardTypes(db) {
    var rows = DatabaseOps.runQueryToObjects(db, "SELECT id, del, lang, name, config FROM card_type");
    var map = new Map();

    for (const r of rows) {
      try {
        r.config = JSON.parse(r.config);
      } catch {
        r.config = {};
      }

      // make sure fields array exists and has at least one field
      if (!Array.isArray(r.config.fields) || r.config.fields.length === 0) {
        r.config.fields = [{ name: "Field1", type: "TEXT" }];
      } else {
        r.config.fields = r.config.fields.map((f, i) => ({
          name: f?.name || `Field${i+1}`,
          type: f?.type || "TEXT"
        }));
      }
      map.set(r.id, r);
    }
    return map;
  },

  getUserLearningData(db) {
    try {
      var decks = DatabaseOps.listDecks(db);
      var allCards = [];

      for (const deck of decks.filter(d => !d.del)) {
        var cards = DatabaseOps.listCardsForDeck(db, deck.id);
        allCards.push(...cards.map(card => ({ ...card, deckName: deck.name, deckLang: deck.lang })));
      }

      var languages = [...new Set(decks.map(d => d.lang).filter(Boolean))];
      const wordLists = {};

      for(const lang of languages) {
        wordLists[lang] = DatabaseOps.listWordListForLanguage(db, lang);
      }

      return {
        decks: decks.filter(d => !d.del),
        cards: allCards.filter(c => !c.del),
        wordLists,
        cardTypes: Array.from(DatabaseOps.readCardTypes(db).values())
      };
    } catch (error) {
      console.error("Failed to get user learning data:", error);
      return { decks: [], cards: [], wordLists: {}, cardTypes: [] };
    }
  }
};

// field name mapping
const FieldMapper = {
  getFieldNames: () => {
    var mappings = Storage.loadMappings();
    var globalMapping = mappings["__global__"] || mappings.__global;

    if(globalMapping && globalMapping.fields && Array.isArray(globalMapping.fields)) {
      return globalMapping.fields.map(f => f.ankiName || f.migakuName);
    }

    return CONFIG.MIGAKU_FIELDS;
  },

  buildFieldValues: async (card, cardType, settings, ensureMediaInZip) => {
    var rawFields = [
      card.primaryField || "",
      card.secondaryField || "",
      ...(card.fields ? card.fields.split("\u001f") : [])
    ];

    var fieldNames = FieldMapper.getFieldNames();
    var processedFields = [];

    for(let i = 0; i < fieldNames.length; i++) {
      var fieldName = fieldNames[i];
      var rawValue = rawFields[i] || "";
      var lowerName = fieldName.toLowerCase();

      if(lowerName.includes("image") && settings.includeImages && rawValue) {
        var mediaName = await ensureMediaInZip(rawValue);
        processedFields.push(mediaName ? `<img src="${mediaName}">` : "");
      } else if(lowerName.includes("audio") && settings.includeAudio && rawValue) {
        var mediaName = await ensureMediaInZip(rawValue);
        processedFields.push(mediaName ? `[sound:${mediaName}]` : "");
      } else {
        if(!settings.keepSyntax && rawValue) {
          // strip out migaku's bracket syntax
          rawValue = rawValue.replaceAll(/\[.*?\]/g, "").replaceAll(/[{}]/g, "");
        }
        processedFields.push(rawValue);
      }
    }

    return processedFields;
  },

  getExpectedFieldCount: () => FieldMapper.getFieldNames().length
};

// protect against exporting academy courses (migaku doesn't want these redistributed)
const DeckProtection = {
  checkForbiddenContent: (cardTypes) => {
    return cardTypes.some(ct => {
      var name = (ct && ct.name) ? String(ct.name) : '';
      return CONFIG.FORBIDDEN_PATTERNS.test(name);
    });
  },

  getForbiddenMessage: () => {
    return 'Migaku Academy/Fundamentals Course Content is not allowed to be exported! ' +
           'If you are not exporting a Migaku course and see this error message, ' +
           'please report it at: https://github.com/wa-ra-ki/Migaku-Exporter/issues';
  }
};

// anki db creation
const AnkiBuilder = {
  createEmptyAnkiDb(SQL) {
    var db = new SQL.Database();
    db.run(`
      CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null) STRICT;
      CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null) STRICT;
      CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null) STRICT;
      CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null) STRICT;
      CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null) STRICT;
      CREATE INDEX ix_cards_nid on cards (nid);
      CREATE INDEX ix_cards_sched on cards (did, queue, due);
      CREATE INDEX ix_cards_usn on cards (usn);
      CREATE INDEX ix_notes_csum on notes (csum);
      CREATE INDEX ix_notes_usn on notes (usn);
      CREATE INDEX ix_revlog_cid on revlog (cid);
      CREATE INDEX ix_revlog_usn on revlog (usn);
    `);
    return db;
  },

  insertCollectionMetadata(db, usedCardTypes, mappings, useTemplates) {
    var mapping = new Map();
    for(const ct of usedCardTypes) {
      mapping.set(ct.id, Number(String(Date.now()).slice(0,10) + String(ct.id)));
    }

    var conf = {
      curDeck: 1,
      curModel: mapping.get(usedCardTypes[0].id).toString()
    };

    var models = {};
    for(const ct of usedCardTypes) {
      var fields = [];

      const fieldNames = FieldMapper.getFieldNames();
      const pushField = (name) => fields.push({
        font: "Arial", media: [], name, ord: fields.length,
        rtl: false, size: 20, sticky: false
      });

      fieldNames.forEach(fieldName => pushField(fieldName));

      // try to create better templates based on card type
      let template;
      try {
        if (useTemplates) {
          const lower = (ct.name || "").toLowerCase();
          if (lower.includes("sentence")) {
            template = {
              name: "Basic",
              qfmt: `{{${fields[0].name}}}<br>{{${fields[1].name}}}`,
              did: null,
              bafmt: "",
              afmt: `{{FrontSide}}<hr id="answer"><br>${fields.slice(0,5).map(f=>`{{${f.name}}}<br>`).join("")}`,
              ord: 0,
              bqfmt: ""
            };
          } else {
            template = {
              name: "Basic",
              qfmt: `{{${fields[0].name}}}`,
              did: null,
              bafmt: "",
              afmt: `{{FrontSide}}<hr id="answer"><br>${fields.slice(1).map(f=>`{{${f.name}}}`).join("<br>")}`,
              ord: 0,
              bqfmt: ""
            };
          }
        } else {
          template = {
            name: "Basic",
            qfmt: `{{${fields[0].name}}}`,
            did: null,
            bafmt: "",
            afmt: `{{FrontSide}}<hr id="answer"><br>${fields.slice(1).map(f=>`{{${f.name}}}`).join("<br>")}`,
            ord: 0,
            bqfmt: ""
          };
        }
      } catch {
        const firstFieldName = fields.length > 0 ? fields[0].name : "Word";
        const secondFieldName = fields.length > 1 ? fields[1].name : "Sentence";
        template = {
          name: "Basic",
          qfmt: `{{${firstFieldName}}}`,
          did: null,
          bafmt: "",
          afmt: `{{FrontSide}}<hr id='answer'><br>{{${secondFieldName}}}`,
          ord: 0,
          bqfmt: ""
        };
      }

      models[mapping.get(ct.id)] = {
        css: "",
        did: 1,
        flds: fields,
        id: mapping.get(ct.id),
        latexPost: "",
        latexPre: "",
        mod: Math.floor(Date.now() / 1000),
        name: ct.name || "base",
        req: [],
        sortf: 0,
        tags: [],
        tmpls: [template],
        type: 0,
        usn: -1,
        vers: []
      };
    }

    const decks = {
      1: {
        name: "Default", extendRev: 10, usn: -1, collapsed: false, browserCollapsed: false,
        newToday: [0,0], revToday: [0,0], lrnToday: [0,0], timeToday: [0,0],
        dyn: 0, extendNew: 10, conf: 1, id: 1, mod: Date.now(), desc: ""
      }
    };

    const dconf = {
      1: {
        autoplay: false, id: 1,
        lapse: {delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0},
        maxTaken: 60, mod: 0, name: "Default",
        new: {bury: true, delays: [1,10], initialFactor: 2500, ints: [1,4,7], order: 1, perDay: 20, separate: true},
        replayq: true,
        rev: {bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100},
        timer: 0, usn: -1
      }
    };

    db.run("INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      1, Math.floor(Date.now()/1000), Date.now(), Date.now(), 11, 0, 0, Date.now(),
      JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks),
      JSON.stringify(dconf), "{}"
    ]);

    return mapping;
  },

  fillRevlogTable(db, reviews) {
    var revIntervals = new Map();
    reviews.sort((a,b) => a.mod - b.mod);

    // migaku counts distinct cardId per day/type, so dedupe
    var uniqueKey = new Set();
    var uniqueReviews = [];

    for (var i = 0; i < reviews.length; i++) {
      var r = reviews[i];
      var key = `${r.cardId}-${r.day}-${r.type}`;
      if (!uniqueKey.has(key)) {
        uniqueKey.add(key);
        uniqueReviews.push(r);
      }
    }

    Utils.log(`fillRevlogTable: ${reviews.length} reviews → ${uniqueReviews.length} unique`);
    var insertedByType = { 0: 0, 1: 0, 2: 0 };

    // make sure review IDs are unique
    var usedReviewIds = new Set();
    var reviewIdCounter = 0;

    db.run("BEGIN TRANSACTION;");

    for (const r of uniqueReviews) {
      var ease = 0;
      if (r.type === 0) ease = 2;
      else if (r.type === 1) ease = 1;
      else if (r.type === 2) ease = 3;

      insertedByType[r.type] = (insertedByType[r.type] || 0) + 1;

      var prevIvl = revIntervals.has(r.cardId) ? revIntervals.get(r.cardId) : 0;

      var reviewId = r.mod;
      while (usedReviewIds.has(reviewId)) {
        reviewId++;
        reviewIdCounter++;
      }
      usedReviewIds.add(reviewId);

      const currentInterval = Math.round(r.interval);

      db.run("INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        reviewId, r.cardId, -1, ease, currentInterval, prevIvl,
        Math.floor(r.factor * 1000), Math.min(r.duration, 60) * 1000,
        r.type === 0 ? 0 : 1
      ]);
      revIntervals.set(r.cardId, currentInterval);
    }
    db.run("COMMIT");

    if (reviewIdCounter > 0) {
      Utils.log(`Fixed ${reviewIdCounter} duplicate review IDs`);
    }
    Utils.log(`Revlog insert - New(0): ${insertedByType[0]}, Fail(1): ${insertedByType[1]}, Pass(2): ${insertedByType[2]}`);
  }
};

// GPT chat feature
const MigakuGPT = {
  isOpen: false,
  chatHistory: [],
  currentDragData: null,
  currentResizeData: null,
  approvedResources: null,

  init: () => {
    MigakuGPT.injectStyles();
    MigakuGPT.createChatWindow();
    MigakuGPT.loadApprovedResources();
  },

  loadApprovedResources: async () => {
    try {
      const response = await ExtensionFetch.json('https://raw.githubusercontent.com/wa-ra-ki/Migaku-Exporter/main/Approved-Links/japanese_videos_batch.json');
      if (response.ok) {
        MigakuGPT.approvedResources = response.data;
        Utils.log("Loaded approved resources for MigakuGPT");
      }
    } catch (error) {
      Utils.log("Could not load approved resources:", error);
    }
  },

  injectStyles: () => {
    if (document.getElementById("mgkChatStyles")) return;

    const styles = document.createElement("style");
    styles.id = "mgkChatStyles";
    styles.textContent = `
      .mgk-chat-modal {
        position: fixed;
        top: 10%;
        right: 20px;
        width: 420px;
        height: 650px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 20px;
        backdrop-filter: blur(20px) saturate(180%);
        box-shadow:
          0 25px 50px rgba(0, 0, 0, 0.15),
          0 8px 32px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
        display: none;
        flex-direction: column;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        overflow: hidden;
        min-width: 320px;
        min-height: 400px;
        transition: all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
      }

      .mgk-chat-header {
        padding: 18px 22px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(15px);
        border-radius: 20px 20px 0 0;
      }

      .mgk-chat-title {
        font-weight: 600;
        color: #4f46e5;
        font-size: 1.1rem;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .mgk-chat-controls {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .mgk-chat-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.9);
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 0.8rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .mgk-chat-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.25);
        transform: translateY(-1px);
      }

      .mgk-chat-messages {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: rgba(255, 255, 255, 0.02);
      }

      .mgk-chat-messages::-webkit-scrollbar {
        width: 4px;
      }

      .mgk-chat-messages::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
      }

      .mgk-chat-messages::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #4f46e5, #06b6d4);
        border-radius: 10px;
      }

      .mgk-chat-message {
        max-width: 85%;
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 0.85rem;
        line-height: 1.5;
        animation: slideInMessage 0.3s ease;
        position: relative;
        white-space: pre-wrap;
        backdrop-filter: blur(15px);
      }

      .mgk-chat-message.user {
        align-self: flex-end;
        background: rgba(79, 70, 229, 0.15);
        border: 1px solid rgba(79, 70, 229, 0.25);
        color: white;
        border-bottom-right-radius: 6px;
      }

      .mgk-chat-message.assistant {
        align-self: flex-start;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-bottom-left-radius: 6px;
      }

      .mgk-chat-message h3,
      .mgk-chat-message h4 {
        margin: 0 0 8px 0;
        color: #4f46e5;
        font-weight: 600;
        font-size: 0.95rem;
      }

      .mgk-chat-message a {
        color: #06b6d4;
        text-decoration: none;
        border-bottom: 1px dotted rgba(6, 182, 212, 0.4);
      }

      .mgk-chat-message a:hover {
        border-bottom: 1px solid #06b6d4;
      }

      .mgk-yt-video {
        margin: 12px 0;
        border-radius: 12px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(15px);
        transition: all 0.3s ease;
      }

      .mgk-yt-thumbnail {
        position: relative;
        height: 200px;
        cursor: pointer;
        overflow: hidden;
        background: linear-gradient(135deg, rgba(79, 70, 229, 0.1), rgba(6, 182, 212, 0.1));
      }

      .mgk-yt-thumbnail:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
      }

      .mgk-yt-thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.3s ease;
      }

      .mgk-yt-thumbnail:hover img {
        transform: scale(1.05);
      }

      .mgk-yt-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .mgk-yt-thumbnail:hover .mgk-yt-overlay {
        opacity: 1;
      }

      .mgk-yt-play {
        width: 60px;
        height: 60px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        color: #4f46e5;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
      }

      .mgk-yt-thumbnail:hover .mgk-yt-play {
        background: linear-gradient(135deg, #4f46e5, #06b6d4);
        color: white;
        transform: scale(1.1);
      }

      .mgk-yt-info {
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.04);
      }

      .mgk-yt-title {
        font-weight: 500;
        color: rgba(255, 255, 255, 0.9);
        font-size: 0.85rem;
        margin-bottom: 4px;
      }

      .mgk-yt-subtitle {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
      }

      .mgk-yt-iframe-container {
        position: relative;
        background: rgba(0, 0, 0, 0.3);
        padding: 8px;
      }

      .mgk-yt-iframe-container iframe {
        width: 100%;
        height: 250px;
        border: none;
        border-radius: 8px;
      }

      .mgk-yt-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 30px;
        height: 30px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        z-index: 10;
        transition: all 0.2s ease;
      }

      .mgk-yt-close:hover {
        background: rgba(239, 68, 68, 0.9);
        transform: scale(1.1);
      }

      .mgk-yt-loading {
        padding: 40px;
        text-align: center;
        color: rgba(255, 255, 255, 0.7);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        font-size: 0.85rem;
      }

      .mgk-yt-spinner {
        width: 24px;
        height: 24px;
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-top: 2px solid #4f46e5;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .mgk-link-preview {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 12px;
        margin: 8px 0;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        gap: 12px;
        align-items: center;
        backdrop-filter: blur(10px);
      }

      .mgk-link-preview:hover {
        background: rgba(255, 255, 255, 0.1);
        transform: translateY(-1px);
        border-color: rgba(255, 255, 255, 0.2);
      }

      .mgk-link-preview-icon {
        width: 36px;
        height: 36px;
        background: linear-gradient(135deg, #4f46e5, #06b6d4);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 600;
        font-size: 0.8rem;
        flex-shrink: 0;
      }

      .mgk-link-preview-content {
        flex: 1;
        min-width: 0;
      }

      .mgk-link-preview-title {
        font-weight: 500;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.9);
        margin-bottom: 2px;
      }

      .mgk-link-preview-url {
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.5);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Input Area Styles */
      .mgk-chat-input-area {
        padding: 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        gap: 12px;
        align-items: flex-end;
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(15px);
      }

      .mgk-chat-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: white;
        padding: 12px 16px;
        border-radius: 24px;
        resize: none;
        min-height: 20px;
        max-height: 100px;
        font-size: 0.85rem;
        font-family: inherit;
        backdrop-filter: blur(10px);
        transition: all 0.2s ease;
      }

      .mgk-chat-input:focus {
        outline: none;
        border-color: rgba(79, 70, 229, 0.4);
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        background: rgba(255, 255, 255, 0.1);
      }

      .mgk-chat-input::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }

      .mgk-chat-send {
        background: linear-gradient(135deg, #4f46e5, #06b6d4);
        border: none;
        color: white;
        padding: 12px 18px;
        border-radius: 24px;
        cursor: pointer;
        font-weight: 500;
        font-size: 0.85rem;
        transition: all 0.2s ease;
        min-width: 60px;
        backdrop-filter: blur(10px);
      }

      .mgk-chat-send:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(79, 70, 229, 0.3);
      }

      .mgk-chat-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      /* API Key Setup */
      .mgk-api-key-setup {
        padding: 24px 16px;
        text-align: center;
        color: rgba(255, 255, 255, 0.8);
        background: rgba(255, 255, 255, 0.04);
        border-radius: 12px;
        margin: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(15px);
      }

      .mgk-api-key-input {
        width: 100%;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: white;
        padding: 12px 16px;
        border-radius: 10px;
        margin: 12px 0;
        font-size: 0.85rem;
        backdrop-filter: blur(10px);
        transition: all 0.2s ease;
        box-sizing: border-box;
      }

      .mgk-api-key-input:focus {
        outline: none;
        border-color: rgba(79, 70, 229, 0.5);
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        background: rgba(255, 255, 255, 0.12);
      }

      /* Other UI Elements */
      .mgk-resize-handle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 20px;
        height: 20px;
        cursor: se-resize;
        background: linear-gradient(135deg, rgba(79, 70, 229, 0.2), rgba(6, 182, 212, 0.2));
        border-radius: 20px 0 20px 0;
        opacity: 0.6;
        transition: opacity 0.2s ease;
      }

      .mgk-resize-handle:hover {
        opacity: 1;
      }

      .mgk-quick-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0;
      }

      .mgk-quick-action {
        background: rgba(79, 70, 229, 0.12);
        border: 1px solid rgba(79, 70, 229, 0.25);
        color: rgba(255, 255, 255, 0.9);
        padding: 8px 14px;
        border-radius: 20px;
        font-size: 0.75rem;
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .mgk-quick-action:hover {
        background: rgba(79, 70, 229, 0.2);
        transform: translateY(-1px);
        border-color: rgba(79, 70, 229, 0.4);
      }

      .mgk-loading {
        display: flex;
        align-items: center;
        gap: 8px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 0.8rem;
      }

      .mgk-loading::after {
        content: '';
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-top: 2px solid #4f46e5;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      @keyframes slideInMessage {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `;

    document.head.appendChild(styles);
  },

  createChatWindow: () => {
    if (document.getElementById(CONFIG.CHAT_MODAL_ID)) return;

    const chatModal = document.createElement("div");
    chatModal.id = CONFIG.CHAT_MODAL_ID;
    chatModal.className = "mgk-chat-modal";

    chatModal.innerHTML = `
      <div class="mgk-chat-header" id="mgkChatHeader">
        <div class="mgk-chat-title">MigakuGPT</div>
        <div class="mgk-chat-controls">
          <button class="mgk-chat-btn" id="mgkChatClear">Clear</button>
          <button class="mgk-chat-btn" id="mgkChatClose">×</button>
        </div>
      </div>

      <div class="mgk-chat-messages" id="mgkChatMessages">
        <div id="mgkApiKeySetup" class="mgk-api-key-setup">
          <p>Enter your OpenAI API key to use MigakuGPT:</p>
          <input type="password" class="mgk-api-key-input" id="mgkApiKeyInput" placeholder="sk-proj-...">
          <br>
          <button class="mgk-chat-btn" id="mgkSaveApiKey" style="margin-top: 12px;">Save API Key</button>
          <p style="font-size: 0.75rem; margin-top: 12px; opacity: 0.7;">
            Stored locally only. Get one at <a href="https://platform.openai.com/api-keys" target="_blank" style="color: #4f46e5;">OpenAI Platform</a>
          </p>
        </div>
      </div>

      <div class="mgk-chat-input-area" id="mgkChatInputArea" style="display: none;">
        <textarea class="mgk-chat-input" id="mgkChatInput" placeholder="Ask about learning progress, find videos, or get study help..." rows="1"></textarea>
        <button class="mgk-chat-send" id="mgkChatSend">Send</button>
      </div>

      <div class="mgk-resize-handle" id="mgkResizeHandle"></div>
    `;

    document.body.appendChild(chatModal);
    MigakuGPT.setupEventListeners();
    MigakuGPT.checkApiKey();
  },

  setupEventListeners: () => {
    const chatModal = Utils.safeGetElement(CONFIG.CHAT_MODAL_ID);
    const header = Utils.safeGetElement("mgkChatHeader");
    const resizeHandle = Utils.safeGetElement("mgkResizeHandle");

    Utils.safeAddListener(header, "mousedown", (e) => {
      if (e.target.closest('.mgk-chat-controls')) return;

      MigakuGPT.currentDragData = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        initialX: chatModal.offsetLeft,
        initialY: chatModal.offsetTop
      };

      header.style.cursor = "grabbing";
      chatModal.style.transition = "none";
      e.preventDefault();
    });

    Utils.safeAddListener(document, "mousemove", (e) => {
      if (!MigakuGPT.currentDragData?.isDragging && !MigakuGPT.currentResizeData?.isResizing) return;

      if (MigakuGPT.currentDragData?.isDragging) {
        const deltaX = e.clientX - MigakuGPT.currentDragData.startX;
        const deltaY = e.clientY - MigakuGPT.currentDragData.startY;

        const newX = Math.max(0, Math.min(window.innerWidth - chatModal.offsetWidth,
          MigakuGPT.currentDragData.initialX + deltaX));
        const newY = Math.max(0, Math.min(window.innerHeight - chatModal.offsetHeight,
          MigakuGPT.currentDragData.initialY + deltaY));

        chatModal.style.left = `${newX}px`;
        chatModal.style.top = `${newY}px`;
        chatModal.style.right = "auto";
        chatModal.style.bottom = "auto";
      }

      if (MigakuGPT.currentResizeData?.isResizing) {
        const deltaX = e.clientX - MigakuGPT.currentResizeData.startX;
        const deltaY = e.clientY - MigakuGPT.currentResizeData.startY;

        const newWidth = Math.max(320, MigakuGPT.currentResizeData.initialWidth + deltaX);
        const newHeight = Math.max(400, MigakuGPT.currentResizeData.initialHeight + deltaY);

        chatModal.style.width = `${newWidth}px`;
        chatModal.style.height = `${newHeight}px`;
      }

      e.preventDefault();
    });

    Utils.safeAddListener(document, "mouseup", () => {
      if (MigakuGPT.currentDragData?.isDragging) {
        MigakuGPT.currentDragData = null;
        header.style.cursor = "move";
        chatModal.style.transition = "all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)";
      }
      if (MigakuGPT.currentResizeData?.isResizing) {
        MigakuGPT.currentResizeData = null;
      }
    });

    Utils.safeAddListener(resizeHandle, "mousedown", (e) => {
      MigakuGPT.currentResizeData = {
        isResizing: true,
        startX: e.clientX,
        startY: e.clientY,
        initialWidth: chatModal.offsetWidth,
        initialHeight: chatModal.offsetHeight
      };

      chatModal.style.transition = "none";
      e.preventDefault();
      e.stopPropagation();
    });

    Utils.safeAddListener(Utils.safeGetElement("mgkChatClose"), "click", MigakuGPT.close);
    Utils.safeAddListener(Utils.safeGetElement("mgkChatClear"), "click", MigakuGPT.clearChat);
    Utils.safeAddListener(Utils.safeGetElement("mgkSaveApiKey"), "click", MigakuGPT.saveApiKey);
    Utils.safeAddListener(Utils.safeGetElement("mgkChatSend"), "click", MigakuGPT.sendMessage);

    const chatInput = Utils.safeGetElement("mgkChatInput");
    Utils.safeAddListener(chatInput, "keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        MigakuGPT.sendMessage();
      }
    });

    Utils.safeAddListener(chatInput, "input", (e) => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
    });
  },

  checkApiKey: () => {
    const apiKey = Storage.loadApiKey();
    if (apiKey) {
      Utils.safeGetElement("mgkApiKeySetup").style.display = "none";
      Utils.safeGetElement("mgkChatInputArea").style.display = "flex";
      MigakuGPT.initializeChat();
    }
  },

  saveApiKey: () => {
    const input = Utils.safeGetElement("mgkApiKeyInput");
    const apiKey = input.value.trim();

    if (!apiKey.startsWith("sk-")) {
      alert("Please enter a valid OpenAI API key (starts with 'sk-')");
      return;
    }

    Storage.saveApiKey(apiKey);
    MigakuGPT.checkApiKey();
  },

  initializeChat: () => {
    const messagesContainer = Utils.safeGetElement("mgkChatMessages");
    messagesContainer.innerHTML = `
      <div class="mgk-chat-message assistant">
        <h3>Welcome to MigakuGPT!</h3>

        I'm your AI learning assistant with access to your Migaku data. I can help with:

        <h4>Learning Analytics</h4>
        • Analyze deck progress and performance
        • Track vocabulary acquisition rates
        • Identify learning patterns

        <h4>Study Strategies</h4>
        • Custom study schedules
        • Memory optimization techniques
        • Targeted practice recommendations

        <h4>Video Resources</h4>
        • Find relevant learning videos
        • Grammar explanations
        • Pronunciation guides

        <h4>Migaku Optimization</h4>
        • Export strategies
        • Deck organization advice
        • Troubleshooting help

        <div class="mgk-quick-actions">
          <span class="mgk-quick-action" data-message="Show my learning stats">My Stats</span>
          <span class="mgk-quick-action" data-message="What should I study today?">Study Plan</span>
          <span class="mgk-quick-action" data-message="Find grammar videos for beginners">Grammar Videos</span>
        </div>
      </div>
    `;

    messagesContainer.querySelectorAll('.mgk-quick-action').forEach(button => {
      Utils.safeAddListener(button, 'click', () => {
        const message = button.getAttribute('data-message');
        if (message) {
          MigakuGPT.quickMessage(message);
        }
      });
    });

    MigakuGPT.chatHistory = [];
  },

  open: () => {
    const chatModal = Utils.safeGetElement(CONFIG.CHAT_MODAL_ID);
    if (chatModal) {
      chatModal.style.display = "flex";
      MigakuGPT.isOpen = true;

      const input = Utils.safeGetElement("mgkChatInput");
      if (input) setTimeout(() => input.focus(), 150);
    }
  },

  close: () => {
    const chatModal = Utils.safeGetElement(CONFIG.CHAT_MODAL_ID);
    if (chatModal) {
      chatModal.style.display = "none";
      MigakuGPT.isOpen = false;
    }
  },

  clearChat: () => {
    MigakuGPT.chatHistory = [];
    MigakuGPT.initializeChat();
  },

    addMessage: (content, isUser = false) => {
        const messagesContainer = Utils.safeGetElement("mgkChatMessages");
        const messageDiv = document.createElement("div");
        messageDiv.className = `mgk-chat-message ${isUser ? 'user' : 'assistant'}`;

        // simple markdown parsing
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
        content = content.replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:0.8rem;">$1</code>');
        content = content.replace(/^### (.*$)/gm, '<h4>$1</h4>');
        content = content.replace(/^## (.*$)/gm, '<h3>$1</h3>');
        content = content.replace(/^- (.*$)/gm, '• $1');

        messageDiv.innerHTML = content;

        if(!isUser) {
            MigakuGPT.replaceYouTubeLinks(messageDiv);
        }

        // Attach click handlers for link previews (replaces inline onclick blocked by MV3 CSP)
        messageDiv.querySelectorAll('.mgk-link-preview[data-href]').forEach(el => {
            el.addEventListener('click', () => {
                window.open(el.getAttribute('data-href'), '_blank', 'noopener,noreferrer');
            });
        });

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },

  formatMessage: (content) => {
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
    content = content.replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:0.8rem;">$1</code>');
    content = content.replace(/^### (.*$)/gm, '<h4>$1</h4>');
    content = content.replace(/^## (.*$)/gm, '<h3>$1</h3>');
    content = content.replace(/^- (.*$)/gm, '• $1');
    content = MigakuGPT.processVideoLinks(content);
    content = MigakuGPT.processLinkPreviews(content);

    return content;
  },
    replaceYouTubeLinks: (container) => {
        // regex for youtube URLs - supports youtube.com, youtu.be, mobile, embed formats
        const youtubeRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/g;

        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const matches = [...text.matchAll(youtubeRegex)];

            if (matches.length > 0) {
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;

                matches.forEach(match => {
                    const [fullMatch, videoId] = match;
                    const matchStart = match.index;

                    if (matchStart > lastIndex) {
                        fragment.appendChild(
                            document.createTextNode(text.slice(lastIndex, matchStart))
                        );
                    }

                    const videoElement = MigakuGPT.createVideoElement(videoId);
                    fragment.appendChild(videoElement);

                    lastIndex = matchStart + fullMatch.length;
                });

                if (lastIndex < text.length) {
                    fragment.appendChild(
                        document.createTextNode(text.slice(lastIndex))
                    );
                }

                textNode.parentNode.replaceChild(fragment, textNode);
            }
        });
    },
    createVideoElement: (videoId) => {
        const container = document.createElement('div');
        container.className = 'yt-video-card';
        container.style.cssText = `
            background: linear-gradient(135deg, rgba(79, 70, 229, 0.15), rgba(168, 85, 247, 0.15));
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            overflow: hidden;
            margin: 12px 0;
            cursor: pointer;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        `;

        const preview = document.createElement('div');
        preview.style.cssText = `
            position: relative;
            height: 180px;
            background: rgba(0, 0, 0, 0.2);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const img = document.createElement('img');
        img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        img.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s ease;
        `;
        img.onerror = () => {
            img.style.display = 'none';
            preview.innerHTML = '<div style="color: rgba(255,255,255,0.6); font-size: 3rem;">📺</div>';
        };

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

        const playBtn = document.createElement('div');
        playBtn.innerHTML = '>';
        playBtn.style.cssText = `
            width: 60px;
            height: 60px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            color: #4f46e5;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
        `;

        const info = document.createElement('div');
        info.style.cssText = `
            padding: 12px 16px;
            background: rgba(255, 255, 255, 0.05);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        const title = document.createElement('span');
        title.textContent = 'YouTube Video';
        title.style.cssText = `
            font-weight: 500;
            color: rgba(255, 255, 255, 0.9);
            font-size: 0.85rem;
        `;

        const subtitle = document.createElement('span');
        subtitle.textContent = 'Click to watch';
        subtitle.style.cssText = `
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.6);
        `;

        overlay.appendChild(playBtn);
        preview.appendChild(img);
        preview.appendChild(overlay);
        info.appendChild(title);
        info.appendChild(subtitle);
        container.appendChild(preview);
        container.appendChild(info);

        container.addEventListener('mouseenter', () => {
            container.style.transform = 'translateY(-2px)';
            container.style.boxShadow = '0 8px 25px rgba(79, 70, 229, 0.2)';
            overlay.style.opacity = '1';
            if (img.style.display !== 'none') {
                img.style.transform = 'scale(1.05)';
            }
            playBtn.style.background = 'linear-gradient(135deg, #4f46e5, #a855f7)';
            playBtn.style.color = 'white';
        });

        container.addEventListener('mouseleave', () => {
            container.style.transform = '';
            container.style.boxShadow = '';
            overlay.style.opacity = '0';
            if (img.style.display !== 'none') {
                img.style.transform = '';
            }
            playBtn.style.background = 'rgba(255, 255, 255, 0.9)';
            playBtn.style.color = '#4f46e5';
        });

        container.addEventListener('click', () => {
            window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
        });

        return container;
    },
    processVideoLinks: (content) => {
        const youtubeRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/g;

        return content.replace(youtubeRegex, (match, videoId) => {
            if (!videoId || videoId.length !== 11) {
                return `<a href="${match}" target="_blank">${match}</a>`;
            }

            return `<div class="video-card" data-video="${videoId}">
      <div class="video-preview">
        <img src="https://img.youtube.com/vi/${videoId}/maxresdefault.jpg"
             data-fallback-src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg"
             alt="Video preview">
        <div class="play-overlay">
          <svg viewBox="0 0 24 24" class="play-icon">
            <path d="M8 5v14l11-7z" fill="currentColor"/>
          </svg>
        </div>
      </div>
      <div class="video-info">
        <span class="video-label">YouTube Video</span>
        <span class="video-action">Tap to watch</span>
      </div>
    </div>`;
        });
    },

  processLinkPreviews: (content) => {
    const urlRegex = /https?:\/\/(?!(?:www\.)?(?:youtube\.com|youtu\.be))[^\s]+/gi;

    return content.replace(urlRegex, (match) => {
      let domain;
      try {
        domain = new URL(match).hostname.replace('www.', '');
      } catch {
        domain = 'link';
      }

      const icon = domain.substring(0, 2).toUpperCase();
      const title = domain.charAt(0).toUpperCase() + domain.slice(1);

      return `
        <div class="mgk-link-preview" data-href="${match}">
          <div class="mgk-link-preview-icon">${icon}</div>
          <div class="mgk-link-preview-content">
            <div class="mgk-link-preview-title">${title}</div>
            <div class="mgk-link-preview-url">${match}</div>
          </div>
        </div>
      `;
    });
  },

    attachVideoListeners: (messageDiv) => {
        // Fix inline onerror handlers (blocked by MV3 CSP)
        messageDiv.querySelectorAll('img[data-fallback-src]').forEach(img => {
            img.addEventListener('error', function() {
                const fallback = this.getAttribute('data-fallback-src');
                if (fallback && this.src !== fallback) {
                    this.src = fallback;
                }
            });
        });
        messageDiv.querySelectorAll('.video-card').forEach(card => {
            card.addEventListener('click', () => {
                const videoId = card.dataset.video;
                if (!videoId) return;

                const player = document.createElement('div');
                player.className = 'video-player';
                player.innerHTML = `
        <div class="player-header">
          <span>YouTube Video</span>
          <button class="close-btn">×</button>
        </div>
        <div class="player-content">
          <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1"
                  frameborder="0"
                  allowfullscreen
                  allow="autoplay; encrypted-media"></iframe>
        </div>
      `;

                card.replaceWith(player);

                player.querySelector('.close-btn').addEventListener('click', () => {
                    player.replaceWith(card);
                });
            });
        });
    },

  createVideoElement: (videoId) => {
      const container = document.createElement('div');
      container.className = 'yt-video-card';
      container.style.cssText = `
          background: linear-gradient(135deg, rgba(79, 70, 229, 0.15), rgba(168, 85, 247, 0.15));
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          overflow: hidden;
          margin: 12px 0;
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
      `;

      const preview = document.createElement('div');
      preview.style.cssText = `
          position: relative;
          height: 180px;
          background: rgba(0, 0, 0, 0.2);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
      `;

      const img = document.createElement('img');
      img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      img.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s ease;
      `;
      img.onerror = () => {
          img.style.display = 'none';
          preview.innerHTML = '<div style="color: rgba(255,255,255,0.6); font-size: 3rem;">📺</div>';
      };

      const overlay = document.createElement('div');
      overlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;
      `;

      const playBtn = document.createElement('div');
      playBtn.innerHTML = '>';
      playBtn.style.cssText = `
          width: 60px;
          height: 60px;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          color: #4f46e5;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          transition: all 0.3s ease;
      `;

      const info = document.createElement('div');
      info.style.cssText = `
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.05);
          display: flex;
          justify-content: space-between;
          align-items: center;
      `;

      const title = document.createElement('span');
      title.textContent = 'YouTube Video';
      title.style.cssText = `
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
          font-size: 0.85rem;
      `;

      const subtitle = document.createElement('span');
      subtitle.textContent = 'Click to play';
      subtitle.style.cssText = `
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.6);
      `;

      overlay.appendChild(playBtn);
      preview.appendChild(img);
      preview.appendChild(overlay);
      info.appendChild(title);
      info.appendChild(subtitle);
      container.appendChild(preview);
      container.appendChild(info);

      container.addEventListener('mouseenter', () => {
          container.style.transform = 'translateY(-2px)';
          container.style.boxShadow = '0 8px 25px rgba(79, 70, 229, 0.2)';
          overlay.style.opacity = '1';
          if(img.style.display !== 'none') {
              img.style.transform = 'scale(1.05)';
          }
          playBtn.style.background = 'linear-gradient(135deg, #4f46e5, #a855f7)';
          playBtn.style.color = 'white';
      });

      container.addEventListener('mouseleave', () => {
          container.style.transform = '';
          container.style.boxShadow = '';
          overlay.style.opacity = '0';
          if(img.style.display !== 'none') {
              img.style.transform = '';
          }
          playBtn.style.background = 'rgba(255, 255, 255, 0.9)';
          playBtn.style.color = '#4f46e5';
      });

      container.addEventListener('click', () => {
          MigakuGPT.expandVideo(container, videoId);
      });

      return container;
  },


  expandVideo: (container, videoId) => {
      const player = document.createElement('div');
      player.style.cssText = `
          background: rgba(0, 0, 0, 0.9);
          border-radius: 12px;
          overflow: hidden;
          margin: 12px 0;
          border: 1px solid rgba(255, 255, 255, 0.1);
      `;

      const header = document.createElement('div');
      header.style.cssText = `
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(255, 255, 255, 0.05);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      `;

      const headerTitle = document.createElement('span');
      headerTitle.textContent = 'YouTube Video';
      headerTitle.style.cssText = `
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
      `;

      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '×';
      closeBtn.style.cssText = `
          background: rgba(255, 255, 255, 0.1);
          border: none;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          transition: all 0.2s ease;
      `;

      closeBtn.addEventListener('mouseenter', () => {
          closeBtn.style.background = 'rgba(239, 68, 68, 0.8)';
      });

      closeBtn.addEventListener('mouseleave', () => {
          closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      });

      closeBtn.addEventListener('click', () => {
          player.replaceWith(container);
      });

      const content = document.createElement('div');
      content.style.cssText = `
          position: relative;
          width: 100%;
          height: 250px;
      `;

      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`;
      iframe.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          border: none;
      `;

      iframe.setAttribute('title', 'YouTube video player');
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');

      content.appendChild(iframe);
      header.appendChild(headerTitle);
      header.appendChild(closeBtn);
      player.appendChild(header);
      player.appendChild(content);

      container.replaceWith(player);
  },

    quickMessage: (message) => {
        const input = Utils.safeGetElement("mgkChatInput");
        if (!input) {
            console.error("[MGK] Chat input not found");
            return;
        }

        input.value = message;

        try {
            input.dispatchEvent(new Event('input'));
        } catch (e) {
            console.warn("[MGK] Failed to dispatch input event:", e);
        }

        MigakuGPT.sendMessage();
    },

   quickMessage: (message) => {
    const input = Utils.safeGetElement("mgkChatInput");
    if (!input) {
      console.error("[MGK] Chat input not found");
      return;
    }

    input.value = message;

    try {
      input.dispatchEvent(new Event('input'));
    } catch (e) {
      console.warn("[MGK] Failed to dispatch input event:", e);
    }

    MigakuGPT.sendMessage();
  },

  sendMessage: async () => {
    const input = Utils.safeGetElement("mgkChatInput");
    const sendBtn = Utils.safeGetElement("mgkChatSend");
    const message = input?.value?.trim();

    if (!message) return;

    input.value = "";
    input.style.height = "auto";
    if(sendBtn) sendBtn.disabled = true;

    MigakuGPT.addMessage(message, true);
    MigakuGPT.chatHistory.push({ role: "user", content: message });

    // show loading
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "mgk-chat-message assistant mgk-loading";
    loadingDiv.innerHTML = "Thinking...";
    const messagesContainer = Utils.safeGetElement("mgkChatMessages");
    if(messagesContainer) messagesContainer.appendChild(loadingDiv);

    try {
      const response = await MigakuGPT.callOpenAI(message);
      if(loadingDiv.parentNode) loadingDiv.remove();
      MigakuGPT.addMessage(response);
      MigakuGPT.chatHistory.push({ role: "assistant", content: response });
    } catch (error) {
      if(loadingDiv.parentNode) loadingDiv.remove();
      MigakuGPT.addMessage(`Error: ${error.message}. Please check your API key.`);
    }

    if(sendBtn) sendBtn.disabled = false;
    if(input) input.focus();
  },

  callOpenAI: async (message) => {
    const apiKey = Storage.loadApiKey();
    const systemPrompt = await MigakuGPT.getSystemPrompt();

    const response = await ExtensionFetch.json("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...MigakuGPT.chatHistory.slice(-8), // keep last 8 for context otherwise token usage gets crazy
          { role: "user", content: message }
        ],
        functions: [
          {
            name: "web_search",
            description: "Search the web for educational content, videos, and learning resources.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" },
                max_results: { type: "integer", description: "Max number of results", default: 3 }
              },
              required: ["query"]
            }
          }
        ],
        max_tokens: 1200,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = response.data || {};
      throw new Error(`API Error ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = response.data;
    const choice = data.choices[0];


    if (choice.message.function_call) {
      const functionName = choice.message.function_call.name;
      const functionArgs = JSON.parse(choice.message.function_call.arguments);

      if (functionName === "web_search") {
        const searchResults = await MigakuGPT.performWebSearch(functionArgs.query, functionArgs.max_results || 3);

        // send results back to gpt
        const followUpResponse = await ExtensionFetch.json("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              ...MigakuGPT.chatHistory.slice(-8),
              { role: "user", content: message },
              { role: "assistant", content: null, function_call: choice.message.function_call },
              { role: "function", name: "web_search", content: JSON.stringify(searchResults) }
            ],
            max_tokens: 1200,
            temperature: 0.7
          })
        });

        if (!followUpResponse.ok) {
          throw new Error(`Follow-up API Error ${followUpResponse.status}`);
        }

        const followUpData = followUpResponse.data;
        return followUpData.choices[0].message.content;
      }
    }

    return choice.message.content;
  },

  performWebSearch: async (query, maxResults = 3) => {
    try {
      const response = await ExtensionFetch.json('https://raw.githubusercontent.com/wa-ra-ki/Migaku-Exporter/main/japanese_videos_batch.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const videoData = response.data;
      const searchTerms = query.toLowerCase().split(' ');
      const matchedVideos = [];

      // score each video based on search terms
      for (const video of videoData) {
        let score = 0;
        const searchableText = [
          video.title,
          video.category,
          video.notes,
          ...(video.tags || [])
        ].join(' ').toLowerCase();

        for (const term of searchTerms) {
          if (searchableText.includes(term)) {
            score += 1;
            if (video.title.toLowerCase().includes(term)) {
              score += 2; // title matches are more relevant
            }
            if (video.category.toLowerCase().includes(term)) {
              score += 1.5;
            }
            if (video.tags && video.tags.some(tag => tag.toLowerCase().includes(term))) {
              score += 1;
            }
          }
        }

        if (score > 0) {
          matchedVideos.push({
            ...video,
            relevanceScore: score
          });
        }
      }

      const sortedVideos = matchedVideos
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxResults);

      const results = sortedVideos.map(video => ({
        title: video.title,
        snippet: video.notes || `${video.category} - Level: ${video.level}`,
        url: video.url,
        source: "Curated Japanese Learning Videos",
        channel: video.category,
        level: video.level,
        tags: video.tags
      }));

      return {
        query: query,
        results: results,
        timestamp: new Date().toISOString(),
        source: "japanese_videos_batch.json"
      };

    } catch (error) {
      console.error("Failed to fetch video data:", error);
      return MigakuGPT.getCuratedVideoSuggestions(query, maxResults);
    }
  },

  getCuratedVideoSuggestions: (query, maxResults = 3) => {
    // fallback videos if json fetch fails
    const fallbackData = [
      {
        title: "Japanese Grammar Basics for Beginners",
        snippet: "Complete guide to Japanese grammar fundamentals",
        url: "https://www.youtube.com/watch?v=YOJa7bKjjgo",
        source: "Fallback Suggestions",
        channel: "Grammar Basics",
        level: "beginner",
        tags: ["grammar", "beginner"]
      },
      {
        title: "Learn Japanese Hiragana in 1 Hour",
        snippet: "Master all hiragana characters quickly",
        url: "https://www.youtube.com/watch?v=6p9Il_j0zjc",
        source: "Fallback Suggestions",
        channel: "Writing System",
        level: "beginner",
        tags: ["hiragana", "writing"]
      },
      {
        title: "Japanese Listening Practice for Beginners",
        snippet: "Improve your listening skills with guided practice",
        url: "https://www.youtube.com/watch?v=A1Y6BY6jLyM",
        source: "Fallback Suggestions",
        channel: "Listening Practice",
        level: "beginner",
        tags: ["listening", "practice"]
      }
    ];

    const queryLower = query.toLowerCase();
    let relevantVideos = [];

    for (const video of fallbackData) {
      const searchText = [video.title, video.snippet, video.channel, ...video.tags].join(' ').toLowerCase();
      if (searchText.includes(queryLower) || queryLower.split(' ').some(term => searchText.includes(term))) {
        relevantVideos.push(video);
      }
    }

    if (relevantVideos.length === 0) {
      relevantVideos = fallbackData.slice(0, maxResults);
    }

    return {
      query: query,
      results: relevantVideos.slice(0, maxResults),
      timestamp: new Date().toISOString(),
      note: "Fallback curated videos (JSON fetch failed)"
    };
  },

  getSystemPrompt: async () => {
    let learningData = {};
    let resourcesInfo = "";

    try {
      if (window._mgkSqlDbHandle) {
        learningData = DatabaseOps.getUserLearningData(window._mgkSqlDbHandle);
      }
    } catch (error) {
      Utils.log("Could not access learning data:", error);
    }

    if (MigakuGPT.approvedResources) {
      resourcesInfo = `\n\nAPPROVED RESOURCES:\nI have access to curated Japanese learning videos from a regularly updated database. When users ask for videos or learning resources, I can search through categorized content including:
- Grammar explanations (beginner to advanced)
- Vocabulary building videos
- Listening practice content
- Pronunciation and pitch accent guides
- JLPT preparation materials
- Cultural immersion content

The video database includes detailed categorization by skill level, topic, and learning objectives.`;
    }

    const userStats = MigakuGPT.generateUserStats(learningData);

    return `You are MigakuGPT, an AI language learning assistant with access to the user's Migaku learning data and web search capabilities.

USER'S LEARNING DATA:
${userStats}

CORE CAPABILITIES:
- Analyze learning patterns and progress using actual user data
- Provide personalized study recommendations
- Search the web for educational content, videos, and learning resources
- Find relevant YouTube videos for specific topics
- Optimize Migaku workflows and troubleshoot issues
- Track vocabulary acquisition and review performance

WEB SEARCH USAGE:
- Use the web_search function when users ask for videos, links, or current information
- Search for educational content related to language learning
- Find specific tutorials, grammar explanations, or pronunciation guides
- Look up current language learning resources and tools

VIDEO AND LINK RECOMMENDATIONS:
When providing YouTube links or educational resources:
- Always provide complete, working URLs
- Use descriptive titles and explanations
- Focus on educational content from reputable sources
- Prioritize content that matches the user's learning level and language
- When pasting links Format it like this do not add anything else, it should be exactly like this. DO NOT do [Watch here](link) just paste the link by itself:
                     Video name | Video Author
                     Video Link

RESPONSE GUIDELINES:
- Keep responses CONCISE (under 150 words typically)
- Use bullet points and clear structure for multiple recommendations
- Be direct and actionable, not verbose
- When suggesting videos, provide full YouTube URLs that will embed properly
- Base advice on their actual learning data when available
- Focus on practical solutions over theory
- Use web search when you need current information or specific resources

CONVERSATION STYLE:
- Supportive but realistic about challenges
- Technical when needed but accessible
- Prioritize long-term learning success
- Acknowledge both strengths and improvement areas
- Use search capabilities to provide up-to-date, relevant resources

${resourcesInfo}

Remember: Use the web_search function when users ask for videos, current information, or specific resources you don't have immediate knowledge of. Always provide working links and focus on educational content.`;
  },

  generateUserStats: (learningData) => {
    if (!learningData || !learningData.cards || learningData.cards.length === 0) {
      return "No learning data available.";
    }

    const { decks, cards, wordLists } = learningData;
    const totalDecks = decks.length;
    const totalCards = cards.length;
    const newCards = cards.filter(c => c.reviewCount === 0).length;
    const reviewCards = cards.filter(c => c.interval > 1).length;

    const languageStats = {};
    decks.forEach(deck => {
      const lang = deck.lang || 'Unknown';
      if (!languageStats[lang]) languageStats[lang] = 0;
      languageStats[lang] += cards.filter(c => c.deckLang === lang).length;
    });

    const recentCards = cards.filter(c => c.reviewCount > 0);
    const avgSuccess = recentCards.length > 0 ?
      (recentCards.reduce((sum, c) => sum + (c.passCount / Math.max(c.reviewCount, 1)), 0) / recentCards.length * 100).toFixed(1) : 0;

    return `STATS SUMMARY:
📚 ${totalDecks} decks, ${totalCards} total cards
📊 ${newCards} new, ${reviewCards} review cards
🌍 Languages: ${Object.keys(languageStats).join(', ')}
📈 Success rate: ${avgSuccess}%

Use this data to provide personalized recommendations.`;
  }
};

// field mapping config UI
const MappingModal = {
  create: () => {
    if (document.getElementById(CONFIG.MAPPING_MODAL_ID)) return;

    const backdrop = document.createElement("div");
    backdrop.id = CONFIG.MAPPING_MODAL_ID;
    backdrop.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      display: none;
      z-index: 2147483650;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    `;

    const card = document.createElement("div");
    card.id = "mgkMapCard";
    card.style.cssText = `
      width: 820px;
      max-width: 100%;
      max-height: 90%;
      overflow: hidden;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow:
        0 25px 50px rgba(0, 0, 0, 0.15),
        0 8px 32px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
      padding: 24px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 20px;
      color: white;
    `;

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:16px;";

    const title = document.createElement("div");
    title.textContent = "Field Mapping Configuration";
    title.style.cssText = "font-weight:600;font-size:1.2rem;color:#4f46e5;";
    header.appendChild(title);

    const headerSpacer = document.createElement("div");
    headerSpacer.style.flex = "1";
    header.appendChild(headerSpacer);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      backdrop-filter: blur(10px);
    `;
    closeBtn.addEventListener("click", () => { backdrop.style.display = "none"; });
    header.appendChild(closeBtn);

    card.appendChild(header);

    const body = document.createElement("div");
    body.id = "mgkMapBody";
    body.style.cssText = "overflow:auto;flex:1 1 auto;";
    card.appendChild(body);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:12px;justify-content:flex-end;";

    const createBtn = (text, id, isPrimary = false) => {
      const btn = document.createElement("button");
      btn.id = id;
      btn.textContent = text;
      btn.style.cssText = isPrimary ? `
        background: linear-gradient(135deg, #4f46e5, #06b6d4);
        border: none;
        color: white;
        padding: 10px 20px;
        border-radius: 10px;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      ` : `
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        padding: 10px 20px;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      `;
      return btn;
    };

    btnRow.appendChild(createBtn("Save Mapping", "mgkMapSave", true));
    btnRow.appendChild(createBtn("Auto-map", "mgkMapAuto"));
    btnRow.appendChild(createBtn("Reset", "mgkMapReset"));

    card.appendChild(btnRow);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    MappingModal.setupEventHandlers();
  },

  setupEventHandlers: () => {
    const card = Utils.safeGetElement("mgkMapCard");
    if (!card) return;

    Utils.safeAddListener(Utils.safeGetElement("mgkMapAuto"), "click", () => {
      const inputs = card.querySelectorAll("input[data-migaku-name]");
      inputs.forEach(inp => {
        const mig = (inp.getAttribute("data-migaku-name") || "").toLowerCase();
        if (mig.includes("word") && !mig.includes("sentence")) inp.value = "Word";
        else if (mig.includes("sentence") && !mig.includes("translated")) inp.value = "Sentence";
        else if (mig.includes("translated")) inp.value = "Translation";
        else if (mig.includes("definition")) inp.value = "Definition";
        else if (mig.includes("image")) inp.value = "Image";
        else if (mig.includes("audio")) inp.value = "Audio";
        else inp.value = inp.getAttribute("data-migaku-name");
      });
    });

    Utils.safeAddListener(Utils.safeGetElement("mgkMapReset"), "click", () => {
      const inputs = card.querySelectorAll("input[data-migaku-name]");
      inputs.forEach(inp => {
        inp.value = inp.getAttribute("data-migaku-name");
      });
    });

    Utils.safeAddListener(Utils.safeGetElement("mgkMapSave"), "click", () => {
      const inputs = card.querySelectorAll("input[data-migaku-name]");
      const arr = [];
      inputs.forEach(inp => {
        arr.push({
          migakuName: inp.getAttribute("data-migaku-name"),
          ankiName: (inp.value || inp.getAttribute("data-migaku-name"))
        });
      });

      const cur = Storage.loadMappings();
      cur["__global__"] = { fields: arr, sfldIndex: 0 };
      Storage.saveMappings(cur);
      Utils.setStatus("Global field mapping saved successfully!", "#10b981");
      Utils.safeGetElement(CONFIG.MAPPING_MODAL_ID).style.display = "none";
    });
  },

  open: () => {
    MappingModal.renderGlobalMapping();
    Utils.safeGetElement(CONFIG.MAPPING_MODAL_ID).style.display = "flex";
  },

renderGlobalMapping: () => {
    const body = Utils.safeGetElement("mgkMapBody");
    if (!body) return;

    body.innerHTML = "";

    const info = document.createElement("div");
    info.style.cssText = "margin-bottom:20px;color:rgba(255,255,255,0.7);font-size:0.9rem;";
    info.textContent = "Customize the Anki field names that will be applied to every card type. These names will become the Anki model field names.";
    body.appendChild(info);

    const mappings = Storage.loadMappings();
    const existing = mappings["__global__"] || mappings.__global || null;

    const fieldsContainer = document.createElement("div");
    fieldsContainer.style.cssText = "display:flex;flex-direction:column;gap:16px;";

    CONFIG.MIGAKU_FIELDS.forEach((migName, idx) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:16px;align-items:center;";

      const left = document.createElement("div");
      left.style.cssText = "width:40%;font-size:0.9rem;color:rgba(255,255,255,0.8);font-weight:500;";
      left.textContent = migName;

      const right = document.createElement("div");
      right.style.width = "60%";

      const inp = document.createElement("input");
      inp.style.cssText = `
        font-size:0.9rem;
        padding:12px 16px;
        width:100%;
        box-sizing:border-box;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: white;
        border-radius: 10px;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      `;
      inp.setAttribute("data-migaku-name", migName);

      let currentValue = migName;
      if (existing && existing.fields && existing.fields[idx]) {
        currentValue = existing.fields[idx].ankiName || migName;
      }
      inp.value = currentValue;

      inp.addEventListener("focus", () => {
        inp.style.borderColor = "rgba(79, 70, 229, 0.5)";
        inp.style.boxShadow = "0 0 0 3px rgba(79, 70, 229, 0.1)";
      });

      inp.addEventListener("blur", () => {
        inp.style.borderColor = "rgba(255, 255, 255, 0.15)";
        inp.style.boxShadow = "none";
      });

      right.appendChild(inp);
      row.appendChild(left);
      row.appendChild(right);
      fieldsContainer.appendChild(row);
    });

    body.appendChild(fieldsContainer);
  }
};

// media download and caching
const MediaHandler = {
  async fetchRemoteMediaBlob(path, auth) {
    if (!auth) auth = await FirebaseAuth.getAccessToken().catch(() => null);
    if (auth && auth.expiresAt < Date.now()) {
      const fresh = await FirebaseAuth.getAccessToken();
      auth.token = fresh.token;
      auth.expiresAt = fresh.expiresAt;
    }

    const base = "https://file-sync-worker-api.migaku.com/data/";
    const url = base + path;

    try {
      const blob = await ExtensionFetch.blob(url, {
        headers: { Authorization: "Bearer " + (auth?.token || "") }
      });
      return blob;
    } catch (e) {
      console.warn("Failed to fetch media:", path, e);
      return null;
    }
  },

  openLocalMediaCacheDb() {
    return new Promise(resolve => {
      const req = indexedDB.open("unofficialmgkexporterMediaDb", 1);
      req.onupgradeneeded = (ev) => {
        const idb = ev.target.result;
        if (!idb.objectStoreNames.contains(CONFIG.MEDIA_STORE_NAME)) {
          idb.createObjectStore(CONFIG.MEDIA_STORE_NAME, {
            keyPath: "key",
            autoIncrement: false
          });
        }
      };
      req.onsuccess = (ev) => resolve(ev.target.result)
      req.onerror = () => resolve(null)
    });
  },

  saveBlobToMediaCache(db, key, blob) {
    return new Promise(resolve => {
      try {
        var tx = db.transaction(CONFIG.MEDIA_STORE_NAME, 'readwrite');
        var store = tx.objectStore(CONFIG.MEDIA_STORE_NAME);
        var addReq = store.add({ key, blob });
        addReq.onsuccess = (ev) => resolve(ev.target?.result)
        addReq.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    });
  },

  getBlobFromMediaCache(db, key) {
    return new Promise(resolve => {
      try {
        if(!db) return resolve(null);
        var req = db.transaction(CONFIG.MEDIA_STORE_NAME, 'readonly')
                     .objectStore(CONFIG.MEDIA_STORE_NAME).get(key);
        req.onsuccess = (ev) => resolve(ev.target.result ? ev.target.result.blob : null)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    });
  },

  async mediaCacheHasKey(db, key) {
    var result = await MediaHandler.getBlobFromMediaCache(db, key);
    return result !== null;
  },

  async gatherMediaFiles(mediaDb, cardsByType, cardTypes, settings) {
    Utils.setStatus("Preparing media list...");
    const pathSet = new Set();

    for (const typeKey of cardsByType.keys()) {
      const list = cardsByType.get(typeKey);
      const ct = cardTypes.get(typeKey);
      const defFields = (ct && ct.config && Array.isArray(ct.config.fields)) ?
        ct.config.fields : [{ name: "Field1", type: "TEXT" }];

      for (const card of list) {
        let fieldIdx = 0;
        const handle = (value) => {
          if (fieldIdx >= defFields.length) return;
          const f = defFields[fieldIdx++];
          if (!value || typeof value !== "string") return;
          if (value.trim().length === 0) return;

          if((f.type === 'IMAGE' && settings.includeImages) ||
              ((f.type === 'AUDIO' || f.type === 'AUDIO_LONG') && settings.includeAudio)) {
            pathSet.add(value.slice(5)); // remove 'data:' prefix
          }
        };

        handle(card.primaryField);
        handle(card.secondaryField);
        if(card.fields) {
          for(const p of card.fields.split('\u001f')) handle(p);
        }
      }
    }

    Utils.setStatus('Downloading media...');
    var queue = Array.from(pathSet);
    var total = queue.length;
    var done = 0;

    if(total === 0) {
      Progress.show('No media to download', 100);
      await Utils.sleep(300);
      Progress.hide();
      return new Map();
    }

    Progress.show('Downloading media...', 0);
    var access = null;
    try {
      access = await FirebaseAuth.getAccessToken();
    } catch {
      access = null;
      // console.log('Firebase auth failed, trying without token')
    }

    var mediaMap = new Map();
    var worker = async () => {
      while(queue.length > 0) {
        var path = queue.shift();
        var extension = (() => {
          var ext = '.' + path.split('.').pop();
          return ext.length >= 7 ? '' : ext;
        })();

        // sha1 hash for filename
        var shaBuf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(path));
        var shaHex = Array.from(new Uint8Array(shaBuf))
                           .map(b => b.toString(16).padStart(2,'0'))
                           .join('') + extension;

        if(mediaDb && await MediaHandler.mediaCacheHasKey(mediaDb, shaHex)) {
          done++;
          Utils.setStatus(`${done}/${total} – from cache: ${path}`);
          Progress.set((done/total)*100, `Downloading media – ${done}/${total}`);
          mediaMap.set(path, shaHex);
          continue;
        }

        var blob = await MediaHandler.fetchRemoteMediaBlob(path, access);
        done++;
        Utils.setStatus(`${done}/${total} – downloaded: ${path}`);
        Progress.set((done/total)*100, `Downloading media – ${done}/${total}`);

        if(!blob) continue;

        if(settings.maxMediaSizeBytes && blob.size > settings.maxMediaSizeBytes) {
          Utils.log('Skipping large media', path, Utils.formatBytes(blob.size));
          continue;
        }

        var outBlob = blob;
        try {
          if(settings.convertMedia && settings.enableImageConversion &&
              path.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
            var resized = await MediaProcessor.imageResizeToBlob(
              blob,
              settings.imageMaxDimension || 1024,
              settings.imageQuality ?? 0.85
            );
            if(resized) outBlob = resized;
          }
        } catch (e) {
          console.warn('Media conversion failed for', path, e);
          outBlob = blob;
        }

        try {
          if(mediaDb) await MediaHandler.saveBlobToMediaCache(mediaDb, shaHex, outBlob);
        } catch (e) {
          console.warn('Cache save failed', e);
        }

        mediaMap.set(path, shaHex);
      }
    };

    const workers = [];
    const workerCount = Math.max(1, settings.mediaWorkerCount || 4);
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);

    Progress.set(100, "Media downloads complete");
    await Utils.sleep(250);
    Progress.hide();
    return mediaMap;
  }
};

// export logic
const ExportProcessor = {
  async fillNotesAndCards(ankiDb, mediaDb, zip, cardsByType, cardTypes, modelMapping, settings) {
    const mediaReverseMap = new Map();
    let nextMediaIndex = 0;

    async function ensureMediaInZip(dirtyPath) {
      if(!dirtyPath) return null;
      if(!mediaDb) return null;

      var path = dirtyPath.slice(5);
      var ext = '.' + path.split('.').pop();
      if(ext.length >= 7) ext = '';

      var shaBuf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(path));
      var shaHex = Array.from(new Uint8Array(shaBuf))
                          .map(b => b.toString(16).padStart(2,'0'))
                          .join('') + ext;

      if(!mediaReverseMap.has(shaHex)) {
        var blob = await MediaHandler.getBlobFromMediaCache(mediaDb, shaHex);
        if(!blob) return null;

        zip.file(String(nextMediaIndex), blob);
        mediaReverseMap.set(shaHex, String(nextMediaIndex));
        nextMediaIndex++;
      }
      return shaHex;
    }

    var totalCards = 0;
    for(const l of cardsByType.values()) totalCards += l.length;
    var processed = 0;

    if(totalCards > 0) Progress.show('Converting cards...', 0);
    else Progress.show('No cards to convert', 100);

    ankiDb.run('BEGIN TRANSACTION;');

    for(const typeKey of cardsByType.keys()) {
      var modelId = modelMapping.get(typeKey);
      var list = cardsByType.get(typeKey);
      var ct = cardTypes.get(typeKey);

      for(const card of list) {
        var finalFieldValues = await FieldMapper.buildFieldValues(
          card, ct, settings, ensureMediaInZip
        );

        var fieldsStr = finalFieldValues.join('\x1F');
        var shaBuf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(fieldsStr));
        var shaHex = Array.from(new Uint8Array(shaBuf))
                            .map(b => b.toString(16).padStart(2,'0'))
                            .join('');
        var fieldsChecksum = parseInt(shaHex.substring(0,8), 16);

        try {
          ankiDb.run('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            card.id, Utils.createUUID(), modelId, card.mod, -1, '',
            fieldsStr, 0, fieldsChecksum, 0, ''
          ]);
        } catch (err) {
          console.error('Note insert failed:', err);
          Utils.setStatus(`Card insert failed: ${err.message}`, '#ef4444');
          continue;
        }

        // Migaku doesn't have separate learning queues like Anki
        // All reviewed cards are just "review" cards with different intervals
        var cardTypeNum = card.reviewCount == 0 ? 0 : 2;
        var cardQueueNum = cardTypeNum;
        var due = 0;
        var interval = 0;

        // Migaku's epoch is Jan 1, 2020, Anki uses days relative to collection creation
        var MIGAKU_EPOCH = new Date(2020, 0, 1, 0, 0, 0, 0);
        var NOW = new Date();
        NOW.setHours(0, 0, 0, 0); // Normalize to midnight

        if(cardTypeNum === 0) {
          // new cards - due is position in new queue
          due = card.due || 0;
          interval = 0;
        } else {
          // review cards - due is days from NOW (collection creation time)
          // Migaku stores due as days since Jan 1, 2020
          var migakuDueDays = card.due;
          var dueDate = new Date(MIGAKU_EPOCH.getTime() + (migakuDueDays * 24 * 60 * 60 * 1000));

          // calculate days between now (at midnight) and the due date
          var daysFromNow = Math.round((dueDate.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000));
          due = daysFromNow;

          // Calculate the actual interval based on when card was last reviewed
          // Migaku stores lastReview as days since epoch
          if (card.lastReview && card.lastReview > 0) {
            var lastReviewDate = new Date(MIGAKU_EPOCH.getTime() + (card.lastReview * 24 * 60 * 60 * 1000));
            // Interval = days between last review and due date
            interval = Math.round((dueDate.getTime() - lastReviewDate.getTime()) / (24 * 60 * 60 * 1000));
          } else {
            // Fallback to Migaku's interval if no lastReview
            interval = Math.floor(card.interval);
          }

          if(processed < 3) {
            Utils.log(`Card ${card.id}: migaku due=${migakuDueDays}, due date=${dueDate.toISOString()}, days from now=${daysFromNow}, lastReview=${card.lastReview}, calculated interval=${interval} days`);
          }
        }

        ankiDb.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          card.id, card.id, 1, 0, card.mod, -1, cardTypeNum, cardQueueNum, due,
          interval, Math.floor(card.factor * 1000),
          card.reviewCount, card.failCount, 0, 0, 0, 0, ''
        ]);

        processed++;
        Progress.set((processed / Math.max(1, totalCards)) * 100,
                    `Converting cards – ${processed}/${totalCards}`);
      }
    }

    ankiDb.run('COMMIT');

    var inverted = Array.from(mediaReverseMap.entries()).map(([sha, idx]) => [idx, sha]);
    zip.file('media', JSON.stringify(Object.fromEntries(inverted)));

    Progress.set(100, "Cards converted");
    await Utils.sleep(120);
    Progress.hide();
  },

  async buildApkgsForSelection(SQL, db, selectedIds, decks, options, mappings) {
    if(!SQL || !SQL.Database) {
      throw new Error("SQL.js runtime not provided");
    }

    var allCards = [];
    for (const id of selectedIds) {
      allCards = allCards.concat(DatabaseOps.listCardsForDeck(db, id).filter(x => !x.del));
    }

    var cardTypes = DatabaseOps.readCardTypes(db);
    var cardsByType = new Map();
    for (const c of allCards) {
      if (!cardsByType.has(c.cardTypeId)) cardsByType.set(c.cardTypeId, []);
      cardsByType.get(c.cardTypeId).push(c);
    }

    var usedCardTypes = Array.from(cardsByType.keys()).map(k => cardTypes.get(k));
    if (DeckProtection.checkForbiddenContent(usedCardTypes)) {
      var msg = DeckProtection.getForbiddenMessage();
      Utils.setStatus(msg, "#ef4444");
      throw new Error(msg);
    }

    if (options.mergeSelected) {
      var mergedName = "Merged - " + selectedIds.map(id =>
        (decks.find(d => String(d.id) === String(id))?.name || id)
      ).join(" + ");

      Utils.setStatus(`Building merged APKG: ${mergedName}`);
      Progress.show("Preparing merged package...", 0);

      var mediaDb = await MediaHandler.openLocalMediaCacheDb();
      if (options.includeMedia && mediaDb) {
        await MediaHandler.gatherMediaFiles(mediaDb, cardsByType, cardTypes, options);
      }

      var zip = new JSZip();
      var ankiDb = AnkiBuilder.createEmptyAnkiDb(SQL);
      // Only include reviews for cards being exported
      var cardIds = new Set(allCards.map(c => c.id));

      // Get reviewHistory days - Migaku only shows stats for days in this table
      const reviewHistoryDays = new Set();
      try {
        const historyRows = DatabaseOps.runQueryToObjects(db, "SELECT day FROM reviewHistory WHERE del = 0");
        historyRows.forEach(row => reviewHistoryDays.add(row.day));
        Utils.log(`Found ${reviewHistoryDays.size} days in reviewHistory table`);
      } catch (e) {
        Utils.log(`No reviewHistory table or error:`, e);
      }

      // Filter reviews: only cards in this deck AND days that exist in reviewHistory
      const reviews = DatabaseOps.listReviewHistory(db).filter(x =>
        !x.del &&
        cardIds.has(x.cardId) &&
        (reviewHistoryDays.size === 0 || reviewHistoryDays.has(x.day))
      );

      // Debug: Log review counts by type
      const reviewsByType = { 0: 0, 1: 0, 2: 0 };
      const reviewsByDay = new Map(); // Track unique cards per day
      reviews.forEach(r => {
        reviewsByType[r.type] = (reviewsByType[r.type] || 0) + 1;
        const dayKey = `${r.day}-${r.type}`;
        if (!reviewsByDay.has(dayKey)) {
          reviewsByDay.set(dayKey, new Set());
        }
        reviewsByDay.get(dayKey).add(r.cardId);
      });

      Utils.log(`=== REVIEW DEBUG INFO ===`);
      Utils.log(`Total review records: ${reviews.length}`);
      Utils.log(`By type - New(0): ${reviewsByType[0]}, Fail(1): ${reviewsByType[1]}, Pass(2): ${reviewsByType[2]}`);

      // Count unique cards per type across all days (matching Migaku's COUNT DISTINCT)
      const uniqueCardsByType = { 0: new Set(), 1: new Set(), 2: new Set() };
      reviews.forEach(r => uniqueCardsByType[r.type].add(`${r.cardId}-${r.day}`));
      Utils.log(`Unique card-day combinations - New(0): ${uniqueCardsByType[0].size}, Fail(1): ${uniqueCardsByType[1].size}, Pass(2): ${uniqueCardsByType[2].size}`);
      Utils.log(`^^^ This should match what Migaku shows! ^^^`);
      Utils.log(`If Migaku shows exactly HALF these numbers, we'll just divide by 2.`);

      AnkiBuilder.fillRevlogTable(ankiDb, reviews);

      const modelMap = AnkiBuilder.insertCollectionMetadata(ankiDb, usedCardTypes, mappings, options.useTemplates);
      await ExportProcessor.fillNotesAndCards(ankiDb, mediaDb, zip, cardsByType, cardTypes, modelMap, options);

      const exported = ankiDb.export();
      zip.file("collection.anki2", exported);
      Progress.set(0, "Zipping .apkg...");

      var blob = await zip.generateAsync({ type: "blob" }, (meta) => {
        if (meta && typeof meta.percent === "number") {
          Progress.set(meta.percent, `Zipping – ${Math.round(meta.percent)}%`);
        }
      });

      var name = `Migaku - ${mergedName}.apkg`;
      ExportProcessor.downloadBlob(blob, name);
      Utils.setStatus("Merged export complete", "#10b981");
      Progress.hide();
    } else {
      for (let i = 0; i < selectedIds.length; i++) {
        var id = selectedIds[i];
        var deckInfo = decks.find(d => String(d.id) === String(id));
        var deckName = deckInfo ? deckInfo.name : `deck-${id}`;

        Utils.setStatus(`Exporting (${i+1}/${selectedIds.length}) – ${deckName} ...`, "#f59e0b");
        Progress.show(`Preparing ${deckName}`, 0);

      var allCards = DatabaseOps.listCardsForDeck(db, id).filter(x => !x.del);
      var cardsByTypeIndividual = new Map();

      for (const c of allCards) {
        if(!cardsByTypeIndividual.has(c.cardTypeId)) cardsByTypeIndividual.set(c.cardTypeId, []);
        cardsByTypeIndividual.get(c.cardTypeId).push(c);
      }        var individualCardTypes = Array.from(cardsByTypeIndividual.keys()).map(k => cardTypes.get(k));
        if (DeckProtection.checkForbiddenContent(individualCardTypes)) {
          var msg = DeckProtection.getForbiddenMessage();
          Utils.setStatus(msg, "#ef4444");
          throw new Error(msg);
        }

        var mediaDb = await MediaHandler.openLocalMediaCacheDb();
        if (options.includeMedia && mediaDb) {
          await MediaHandler.gatherMediaFiles(mediaDb, cardsByTypeIndividual, cardTypes, options);
        }

        var zip = new JSZip();
        var ankiDb = AnkiBuilder.createEmptyAnkiDb(SQL);
        // Only include reviews for cards being exported
        var cardIds = new Set(allCards.map(c => c.id));

        // Get reviewHistory days
        var reviewHistoryDays = new Set();
        try {
          var historyRows = DatabaseOps.runQueryToObjects(db, "SELECT day FROM reviewHistory WHERE del = 0");
          historyRows.forEach(row => reviewHistoryDays.add(row.day));
        } catch (e) {
          // reviewHistory table might not exist
        }

        // Filter reviews to only cards in this deck AND days in reviewHistory
        const reviews = DatabaseOps.listReviewHistory(db).filter(x =>
          !x.del &&
          cardIds.has(x.cardId) &&
          (reviewHistoryDays.size === 0 || reviewHistoryDays.has(x.day))
        );
        AnkiBuilder.fillRevlogTable(ankiDb, reviews);

        const modelMap = AnkiBuilder.insertCollectionMetadata(ankiDb, individualCardTypes, mappings, options.useTemplates);
        await ExportProcessor.fillNotesAndCards(ankiDb, mediaDb, zip, cardsByTypeIndividual, cardTypes, modelMap, options);

        const exported = ankiDb.export();
        zip.file("collection.anki2", exported);
        Progress.set(0, "Zipping .apkg...");

        const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
          if (meta && typeof meta.percent === "number") {
            Progress.set(meta.percent, `Zipping – ${Math.round(meta.percent)}%`);
          }
        });

        const name = `Migaku - ${deckName}.apkg`;
        ExportProcessor.downloadBlob(blob, name);
        Utils.setStatus(`Exported (${i+1}/${selectedIds.length}) – ${deckName}`, "#10b981");
        Progress.set(((i+1)/selectedIds.length)*100, `Overall progress – ${i+1}/${selectedIds.length} exported`);

        await Utils.sleep(200);
      }
      Progress.hide();
    }
  },

  downloadBlob: (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  async exportWordlists(db, language) {
    try {
      Utils.setStatus("Preparing wordlists...");

      // If no language specified, get all word lists
      let wl;
      if (!language) {
        Utils.log("No language specified, getting all word lists");
        wl = DatabaseOps.runQueryToObjects(db,
          "SELECT dictForm, secondary, partOfSpeech, language, mod, serverMod, del, knownStatus, hasCard, tracked FROM WordList"
        );
      } else {
        wl = DatabaseOps.listWordListForLanguage(db, language);
      }

      Utils.log(`Found ${wl.length} words in wordlist`);

      const unknown = [], ignored = [], learning = [], known = [], tracked = [];

      for (const w of wl) {
        if (w.del) continue;
        switch (w.knownStatus) {
          case "UNKNOWN": unknown.push(w); break;
          case "IGNORED": ignored.push(w); break;
          case "LEARNING": learning.push(w); break;
          case "KNOWN": known.push(w); break;
          default: console.log("unknown status", w.knownStatus); break;
        }
        if (w.tracked) tracked.push(w);
      }

      Utils.log(`Wordlist counts - Unknown: ${unknown.length}, Ignored: ${ignored.length}, Learning: ${learning.length}, Known: ${known.length}, Tracked: ${tracked.length}`);

      const q = (s) => `"${(s || "").replaceAll('"','""')}"`;
      const toCsv = (arr) => {
        const header = "dictForm,secondary,hasCard";
        const rows = arr.map(x => `${q(x.dictForm)},${q(x.secondary)},${x.hasCard}`);
        return header + "\n" + rows.join("\n");
      };

      const zip = new JSZip();
      zip.file("unknown.csv", toCsv(unknown));
      zip.file("ignored.csv", toCsv(ignored));
      zip.file("learning.csv", toCsv(learning));
      zip.file("known.csv", toCsv(known));
      zip.file("tracked.csv", toCsv(tracked));

      Progress.set(0, "Zipping wordlists...");
      const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
        if (meta && meta.percent) {
          Progress.set(meta.percent, `Zipping wordlists – ${Math.round(meta.percent)}%`);
        }
      });

      ExportProcessor.downloadBlob(blob, "wordlists.zip");
      Utils.setStatus("Wordlists exported", "#10b981");
      Progress.hide();
    } catch (e) {
      console.error("wordlist failed", e);
      Utils.setStatus("Wordlist export failed – see console", "#ef4444");
      Progress.hide();
    }
  }
};

// UI setup - all the CSS and modal stuff
const UI = {
  injectStyles: () => {
    if (document.getElementById("mgkexporterStyles")) return;

    const styles = document.createElement("style");
    styles.id = "mgkexporterStyles";
    styles.innerHTML = `
      :root {
        --primary-bg: rgba(255, 255, 255, 0.08);
        --secondary-bg: rgba(255, 255, 255, 0.12);
        --border: rgba(255, 255, 255, 0.15);
        --border-hover: rgba(255, 255, 255, 0.25);
        --text-primary: rgba(255, 255, 255, 0.95);
        --text-secondary: rgba(255, 255, 255, 0.7);
        --text-muted: rgba(255, 255, 255, 0.5);
        --accent: #4f46e5;
        --accent-secondary: #06b6d4;
        --success: #10b981;
        --warning: #f59e0b;
        --error: #ef4444;
        --card-width: 820px;
        --border-radius: 12px;
        --border-radius-lg: 16px;
        --shadow-light: 0 4px 16px rgba(0, 0, 0, 0.1);
        --shadow-medium: 0 8px 32px rgba(0, 0, 0, 0.15);
        --shadow-heavy: 0 25px 50px rgba(0, 0, 0, 0.15);
      }

      .mgk-fab {
        position: fixed;
        left: 24px;
        bottom: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        z-index: 2147483646;
        display: grid;
        place-items: center;
        cursor: pointer;
        background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
        backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: var(--shadow-medium);
        color: white;
        font-weight: 600;
        font-size: 18px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .mgk-fab:hover {
        transform: translateY(-4px) scale(1.05);
        box-shadow: var(--shadow-heavy);
        border-color: rgba(255, 255, 255, 0.3);
      }

      .mgk-plus-menu {
        backdrop-filter: blur(20px) saturate(180%);
        background: var(--primary-bg);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow-medium);
      }

      .mgk-plus-item {
        transition: all 0.2s ease;
        color: var(--text-primary);
        font-weight: 500;
      }

      .mgk-plus-item:hover {
        background: var(--secondary-bg) !important;
        color: var(--accent);
      }

      .mgk-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(8px);
        animation: fadeIn 0.3s ease;
      }

      .mgk-modal {
        width: var(--card-width);
        max-width: 95%;
        border-radius: var(--border-radius-lg);
        background: var(--primary-bg);
        backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid var(--border);
        box-shadow:
          var(--shadow-heavy),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
        padding: 24px;
        color: var(--text-primary);
        transform: translateY(20px) scale(0.95);
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: visible;
      }

      .mgk-modal.show {
        transform: translateY(0) scale(1);
        opacity: 1;
      }

      .mgk-title {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0;
        color: var(--accent);
        letter-spacing: -0.025em;
      }

      .mgk-subtitle {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-left: 12px;
        font-weight: 400;
      }

      .mgk-controls {
        margin-top: 20px;
        display: grid;
        gap: 20px;
        transition: all 0.3s ease;
        overflow: visible;
      }

      .mgk-search {
        display: flex;
        gap: 12px;
        align-items: center;
        background: var(--secondary-bg);
        border: 1px solid var(--border);
        padding: 16px 18px;
        border-radius: var(--border-radius);
        width: 100%;
        backdrop-filter: blur(10px);
        transition: all 0.2s ease;
      }

      .mgk-search:focus-within {
        border-color: var(--border-hover);
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
      }

      .mgk-search input {
        width: 100%;
        background: transparent;
        color: var(--text-primary);
        border: none;
        outline: none;
        font-size: 1rem;
        padding: 0;
      }

      .mgk-search input::placeholder {
        color: var(--text-muted);
      }

      .mgk-list {
        max-height: 360px;
        overflow: auto;
        padding: 0;
        border-radius: var(--border-radius);
        background: var(--secondary-bg);
        backdrop-filter: blur(15px);
        border: 1px solid var(--border);
        display: block;
        height: 0;
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-sizing: border-box;
        margin-top: 12px;
      }

      .mgk-list.show {
        height: var(--mgk-list-height, 280px);
        padding: 12px;
        box-shadow: var(--shadow-medium);
        overflow: auto;
      }

      .mgk-list::-webkit-scrollbar {
        width: 6px;
      }

      .mgk-list::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
      }

      .mgk-list::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, var(--accent), var(--accent-secondary));
        border-radius: 10px;
      }

      .mgk-list-inner-item {
        padding: 14px 16px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        gap: 12px;
        transition: all 0.2s ease;
        cursor: pointer;
        font-size: 0.95rem;
        color: var(--text-primary);
        border: 1px solid transparent;
      }

      .mgk-list-inner-item:hover {
        background: var(--secondary-bg);
        border-color: var(--border);
        transform: translateY(-1px);
      }

      .mgk-list-inner-item.selected {
        background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
        color: white;
        font-weight: 600;
        border-color: rgba(255, 255, 255, 0.3);
        box-shadow: var(--shadow-light);
      }

      .mgk-checkbox {
        display: inline-block;
        position: relative;
        vertical-align: middle;
      }

      .mgk-checkbox .mgk-toggle-track {
        width: 52px;
        height: 28px;
        border-radius: 14px;
        background: var(--secondary-bg);
        border: 1px solid var(--border);
        display: inline-block;
        position: relative;
        transition: all 0.3s ease;
      }

      .mgk-checkbox input {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        margin: 0;
        padding: 0;
        cursor: pointer;
      }

      .mgk-checkbox .mgk-toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .mgk-checkbox input:checked ~ .mgk-toggle-track {
        background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
        border-color: rgba(255, 255, 255, 0.3);
      }

      .mgk-checkbox input:checked ~ .mgk-toggle-track .mgk-toggle-knob {
        transform: translateX(24px);
        background: white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .mgk-media-btn {
        padding: 12px 18px;
        border-radius: var(--border-radius);
        border: 1px solid var(--border);
        background: var(--secondary-bg);
        backdrop-filter: blur(10px);
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        gap: 8px;
        align-items: center;
        color: var(--text-primary);
        font-weight: 500;
      }

      .mgk-media-btn:hover {
        border-color: var(--border-hover);
        background: var(--primary-bg);
        transform: translateY(-2px);
        box-shadow: var(--shadow-light);
      }

      .mgk-media-popup {
        position: absolute;
        display: none;
        right: 0;
        top: 48px;
        width: 320px;
        background: var(--primary-bg);
        backdrop-filter: blur(20px) saturate(180%);
        border-radius: var(--border-radius);
        padding: 16px;
        border: 1px solid var(--border);
        box-shadow: var(--shadow-heavy);
        z-index: 1000000;
        transform-origin: top right;
        animation: popupIn 0.25s ease;
      }

      .mgk-media-popup.show {
        display: block;
      }

      @keyframes popupIn {
        from {
          transform: translateY(-8px) scale(0.95);
          opacity: 0;
        }
        to {
          transform: translateY(0) scale(1);
          opacity: 1;
        }
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .mgk-button {
        border-radius: var(--border-radius);
        padding: 12px 20px;
        border: none;
        outline: none;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        position: relative;
        overflow: hidden;
      }

      .mgk-button:not(.mgk-secondary) {
        background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .mgk-button:not(.mgk-secondary):hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-medium);
        border-color: rgba(255, 255, 255, 0.3);
      }

      .mgk-secondary {
        background: var(--secondary-bg);
        color: var(--text-primary);
        border: 1px solid var(--border);
      }

      .mgk-secondary:hover {
        background: var(--primary-bg);
        border-color: var(--border-hover);
        transform: translateY(-1px);
        box-shadow: var(--shadow-light);
      }

      .mgk-input {
        padding: 12px 16px;
        border-radius: var(--border-radius);
        background: var(--secondary-bg);
        border: 1px solid var(--border);
        color: var(--text-primary);
        outline: none;
        width: 100%;
        font-size: 0.95rem;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .mgk-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        background: var(--primary-bg);
      }

      .mgk-input::placeholder {
        color: var(--text-muted);
      }

      select.mgk-input {
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        background-image: linear-gradient(45deg, transparent 50%, var(--text-secondary) 50%),
                          linear-gradient(135deg, var(--text-secondary) 50%, transparent 50%);
        background-position: calc(100% - 20px) calc(1em + 4px),
                            calc(100% - 14px) calc(1em + 4px);
        background-size: 6px 6px, 6px 6px;
        background-repeat: no-repeat;
        padding-right: 40px;
        height: 48px;
      }

      .mgk-status {
        margin-top: 16px;
        padding: 16px;
        border-radius: var(--border-radius);
        background: var(--secondary-bg);
        backdrop-filter: blur(10px);
        border: 1px solid var(--border);
        font-size: 0.95rem;
        min-height: 24px;
        display: flex;
        align-items: center;
        color: var(--text-primary);
        font-weight: 500;
      }

      .mgk-preset {
        position: relative;
        border-radius: var(--border-radius);
        background: var(--secondary-bg);
        border: 1px solid var(--border);
        padding: 12px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 48px;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .mgk-preset:hover {
        border-color: var(--border-hover);
        background: var(--primary-bg);
      }

      .mgk-preset .mgk-preset-label {
        color: var(--text-primary);
        font-size: 0.95rem;
        font-weight: 500;
      }

      .mgk-preset .mgk-preset-arrow {
        margin-left: 12px;
        color: var(--text-secondary);
        transition: transform 0.2s ease;
      }

      .mgk-preset-menu {
        position: absolute;
        right: 0;
        top: 56px;
        background: var(--primary-bg);
        backdrop-filter: blur(20px) saturate(180%);
        border-radius: var(--border-radius);
        padding: 8px;
        box-shadow: var(--shadow-heavy);
        border: 1px solid var(--border);
        display: none;
        z-index: 1000002;
        min-width: 220px;
      }

      .mgk-preset-menu.show {
        display: block;
        animation: popupIn 0.2s ease;
      }

      .mgk-preset-item {
        padding: 12px 16px;
        border-radius: 8px;
        cursor: pointer;
        color: var(--text-primary);
        transition: all 0.2s ease;
        font-weight: 500;
      }

      .mgk-preset-item:hover {
        background: var(--secondary-bg);
        transform: translateY(-1px);
      }

      .mgk-preset-item.selected {
        background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
        color: white;
        font-weight: 600;
      }

      .mgk-small {
        font-size: 0.875rem;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .mgk-row {
        display: flex;
        gap: 24px;
        align-items: flex-start;
      }

      .mgk-media-wrap {
        position: relative;
      }

      @media (max-width: 768px) {
        :root { --card-width: 95vw }
        .mgk-modal {
          padding: 16px;
          border-radius: var(--border-radius);
        }
        .mgk-row {
          flex-direction: column;
          gap: 16px;
        }
      }
      .video-card {
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1));
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 16px;
        overflow: hidden;
        margin: 16px 0;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(20px);
        position: relative;
      }

      .video-card:hover {
        transform: translateY(-4px) scale(1.02);
        box-shadow: 0 20px 40px rgba(99, 102, 241, 0.2);
        border-color: rgba(99, 102, 241, 0.3);
      }

      .video-preview {
        position: relative;
        aspect-ratio: 16/9;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.2);
      }

      .video-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.4s ease;
      }

      .video-card:hover .video-preview img {
        transform: scale(1.1);
      }

      .play-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.3);
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .video-card:hover .play-overlay {
        opacity: 1;
      }

      .play-icon {
        width: 72px;
        height: 72px;
        color: white;
        background: rgba(99, 102, 241, 0.9);
        border-radius: 50%;
        padding: 20px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
      }

      .video-card:hover .play-icon {
        background: linear-gradient(135deg, #6366f1, #a855f7);
        transform: scale(1.1);
      }

      .video-info {
        padding: 16px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(255, 255, 255, 0.05);
      }

      .video-label {
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
        font-size: 0.9rem;
      }

      .video-action {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.6);
        opacity: 0;
        transform: translateX(10px);
        transition: all 0.3s ease;
      }

      .video-card:hover .video-action {
        opacity: 1;
        transform: translateX(0);
      }

      .video-player {
        background: rgba(0, 0, 0, 0.9);
        border-radius: 16px;
        overflow: hidden;
        margin: 16px 0;
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px);
      }

      .player-header {
        padding: 16px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .player-header span {
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
      }

      .close-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        transition: all 0.2s ease;
      }

      .close-btn:hover {
        background: rgba(239, 68, 68, 0.8);
        transform: scale(1.1);
      }

      .player-content {
        aspect-ratio: 16/9;
        position: relative;
      }

      .player-content iframe {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
      }

      @media (max-width: 480px) {
        .video-card {
          margin: 12px 0;
        }

        .play-icon {
          width: 56px;
          height: 56px;
          padding: 16px;
        }

        .video-info {
          padding: 12px 16px;
        }
    `;

    document.head.appendChild(styles);
  },

  createMainUI: () => {
    // Check if UI already exists
    if (Utils.safeGetElement(CONFIG.FAB_ID)) {
      return;
    }

    UI.injectStyles();
    MappingModal.create();

    const fab = document.createElement("div");
    fab.className = "mgk-fab";
    fab.id = CONFIG.FAB_ID;
    fab.title = "Open Migaku Menu";
    fab.innerHTML = "+";
    document.body.appendChild(fab);

    const fabMenu = document.createElement("div");
    fabMenu.className = "mgk-plus-menu";
    fabMenu.id = "mgkFabMenu";
    fabMenu.style.cssText = `
      position: fixed;
      left: 24px;
      bottom: 88px;
      background: var(--primary-bg);
      border: 1px solid var(--border);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-medium);
      display: none;
      flex-direction: column;
      z-index: 2147483646;
      overflow: hidden;
      min-width: 180px;
    `;

    fabMenu.innerHTML = `
      <div class="mgk-plus-item" id="mgkComingSoon" style="padding:12px 16px;color:var(--text-primary);font-size:0.9rem;cursor:pointer;transition:all 0.2s ease;font-weight:500;">Coming Soon</div>
      <div class="mgk-plus-item" id="mgkOpenMigakuGPT" style="padding:12px 16px;color:var(--text-primary);font-size:0.9rem;cursor:pointer;transition:all 0.2s ease;font-weight:500;">MigakuGPT (beta)</div>
      <div class="mgk-plus-item" id="mgkOpenExporter" style="padding:12px 16px;color:var(--text-primary);font-size:0.9rem;cursor:pointer;transition:all 0.2s ease;font-weight:500;">Migaku Exporter</div>
    `;

    document.body.appendChild(fabMenu);


    Utils.safeAddListener(fab, "click", () => {
      const isVisible = fabMenu.style.display === "flex";
      fabMenu.style.display = isVisible ? "none" : "flex";
    });

    Utils.safeAddListener(Utils.safeGetElement("mgkComingSoon"), "click", () => {
      Utils.setStatus("More features coming soon :)", "#06b6d4");
      fabMenu.style.display = "none";
    });

    Utils.safeAddListener(Utils.safeGetElement("mgkOpenMigakuGPT"), "click", () => {
      MigakuGPT.open();
      fabMenu.style.display = "none";
    });

    Utils.safeAddListener(Utils.safeGetElement("mgkOpenExporter"), "click", () => {
      fabMenu.style.display = "none";
      UI.showMainModal();
    });


    document.addEventListener("click", (e) => {
      if (!fab.contains(e.target) && !fabMenu.contains(e.target)) {
        fabMenu.style.display = "none";
      }
    });


    UI.createExportModal();
  },

  createExportModal: () => {
    const backdrop = document.createElement("div");
    backdrop.className = "mgk-modal-backdrop";
    backdrop.id = "mgkModalBackdrop";

    const modal = document.createElement("div");
    modal.className = "mgk-modal";
    modal.id = CONFIG.MODAL_ID;

    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="display:flex;flex-direction:column;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="mgk-title">Migaku → Anki Exporter</div>
            <div class="mgk-subtitle">Created by waraki - Forked from SirOlaf ❤️</div>
          </div>
        </div>
        <div style="margin-left:auto;display:flex;gap:12px;align-items:center">
          <div id="mgkModeLabel" style="font-weight:600;background:var(--secondary-bg);padding:8px 12px;border-radius:8px;color:var(--text-secondary);font-size:0.85rem;border:1px solid var(--border);">Mode: Simple</div>
          <label class="mgk-checkbox" title="Toggle Simple / Advanced">
            <input id="mgkSimpleMode" type="checkbox" checked>
            <span class="mgk-toggle-track">
              <span class="mgk-toggle-knob"></span>
            </span>
          </label>
          <button id="mgkCloseBtn" class="mgk-button mgk-secondary">Close</button>
        </div>
      </div>

      <div class="mgk-controls">
        <div class="mgk-row">
          <div style="flex:1; position:relative;">
            <div class="mgk-search">
              <input id="mgkDeckSearch" placeholder="Search decks…">
            </div>
            <div id="mgkDeckList" class="mgk-list" role="listbox" tabindex="0" aria-label="Deck list"></div>
          </div>

          <div class="mgk-media-wrap">
            <button id="mgkMediaBtn" class="mgk-media-btn">Include media ▾</button>
            <div id="mgkMediaPopup" class="mgk-media-popup" aria-hidden="true">
              <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div class="mgk-small">Images</div>
                  <label class="mgk-checkbox">
                    <input id="mgkIncludeImages" type="checkbox" checked>
                    <span class="mgk-toggle-track">
                      <span class="mgk-toggle-knob"></span>
                    </span>
                  </label>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div class="mgk-small">Audio</div>
                  <label class="mgk-checkbox">
                    <input id="mgkIncludeAudio" type="checkbox" checked>
                    <span class="mgk-toggle-track">
                      <span class="mgk-toggle-knob"></span>
                    </span>
                  </label>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                  <button id="mgkMediaPopupClose" class="mgk-button mgk-secondary">Done</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mgk-row">
          <div style="flex:1">
            <div class="mgk-small">Selected decks</div>
            <div id="mgkSelectedBadge" class="mgk-small" style="padding:12px;border-radius:var(--border-radius);background:var(--secondary-bg);border:1px solid var(--border);margin-top:8px;color:var(--text-primary);">No deck selected</div>
          </div>

          <div style="width:360px;display:flex;flex-direction:column;gap:12px">
            <div id="mgkSimplifiedArea" style="display:block;">
              <div class="mgk-small">File size preset</div>
              <div id="mgkPresetRoot" style="position:relative;">
                <div id="mgkPresetToggle" class="mgk-preset">
                  <div class="mgk-preset-label" id="mgkPresetLabel">Normal</div>
                  <div class="mgk-preset-arrow">▾</div>
                </div>
                <div id="mgkPresetMenu" class="mgk-preset-menu" aria-hidden="true"></div>
              </div>

              <div style="display:flex;gap:16px;align-items:center;margin-top:12px;">
                <div style="display:flex;gap:8px;align-items:center;">
                  <label class="mgk-small">Keep syntax</label>
                  <label class="mgk-checkbox">
                    <input id="mgkKeepSyntax" type="checkbox">
                    <span class="mgk-toggle-track">
                      <span class="mgk-toggle-knob"></span>
                    </span>
                  </label>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                  <label class="mgk-small">Merge decks</label>
                  <label class="mgk-checkbox">
                    <input id="mgkMergeSelected" type="checkbox">
                    <span class="mgk-toggle-track">
                      <span class="mgk-toggle-knob"></span>
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <div id="mgkAdvancedArea" style="display:none;">
              <div style="display:flex;gap:12px;flex-direction:column;">
                <div style="display:flex;gap:8px;align-items:center;">
                  <label class="mgk-small">Convert media</label>
                  <label class="mgk-checkbox">
                    <input id="mgkConvertMedia" type="checkbox">
                    <span class="mgk-toggle-track">
                      <span class="mgk-toggle-knob"></span>
                    </span>
                  </label>
                </div>
                <div style="display:flex;gap:12px;align-items:center;">
                  <div style="flex:1">
                    <div class="mgk-small">Image max px</div>
                    <input id="mgkImageMaxDim" class="mgk-input" type="number" value="1024">
                  </div>
                  <div style="flex:1">
                    <div class="mgk-small">Image quality</div>
                    <input id="mgkImageQuality" class="mgk-input" type="number" step="0.05" min="0.1" max="1" value="0.85">
                  </div>
                </div>
                <div style="display:flex;gap:12px;align-items:center;">
                  <div style="flex:1">
                    <div class="mgk-small">Audio sample rate (Hz)</div>
                    <input id="mgkAudioSampleRate" class="mgk-input" type="number" value="22050">
                  </div>
                  <div style="flex:1">
                    <div class="mgk-small">Max media size (MB)</div>
                    <input id="mgkMaxMediaSize" class="mgk-input" type="number" value="10">
                  </div>
                </div>
              </div>

              <div style="display:flex;gap:8px;align-items:center;margin-top:12px;">
                <label class="mgk-small">Auto-build templates</label>
                <label class="mgk-checkbox">
                  <input id="mgkUseTemplates" type="checkbox" checked>
                  <span class="mgk-toggle-track">
                    <span class="mgk-toggle-knob"></span>
                  </span>
                </label>
              </div>

              <div style="margin-top:12px;">
                <button id="mgkOpenMappingsBtn" class="mgk-button mgk-secondary">Open Field Mapping</button>
              </div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <input type="hidden" id="mgkDeckSelectHidden">
          <button id="mgkExportDeckBtn" class="mgk-button">Export selected decks</button>
          <button id="mgkExportWordlistBtn" class="mgk-button mgk-secondary">Export wordlists</button>
        </div>

        <div id="mgkexporterStatusMessage" class="mgk-status">Ready</div>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);


    Utils.safeAddListener(Utils.safeGetElement("mgkCloseBtn"), "click", UI.hideMainModal);
    Utils.safeAddListener(backdrop, "click", (e) => {
      if (e.target === backdrop) UI.hideMainModal();
    });


    const mediaBtn = Utils.safeGetElement("mgkMediaBtn");
    const mediaPopup = Utils.safeGetElement("mgkMediaPopup");
    function toggleMediaPopup(show) {
      if (show === undefined) show = !mediaPopup.classList.contains("show");
      if (show) mediaPopup.classList.add("show");
      else mediaPopup.classList.remove("show");
    }

    Utils.safeAddListener(mediaBtn, "click", (e) => {
      e.stopPropagation();
      toggleMediaPopup(true);
    });
    Utils.safeAddListener(Utils.safeGetElement("mgkMediaPopupClose"), "click", () => toggleMediaPopup(false));

    document.addEventListener("click", (e) => {
      const popup = Utils.safeGetElement("mgkMediaPopup");
      const btn = Utils.safeGetElement("mgkMediaBtn");
      if (!popup || !btn) return;
      if (!popup.contains(e.target) && !btn.contains(e.target)) {
        popup.classList.remove("show");
      }
    });


    const presetRoot = Utils.safeGetElement("mgkPresetRoot");
    const presetToggle = Utils.safeGetElement("mgkPresetToggle");
    const presetLabel = Utils.safeGetElement("mgkPresetLabel");
    const presetMenu = Utils.safeGetElement("mgkPresetMenu");

    for (const key of Object.keys(CONFIG.PRESETS)) {
      const item = document.createElement("div");
      item.className = "mgk-preset-item";
      item.dataset.preset = key;
      item.innerText = CONFIG.PRESETS[key].label || key;
      if (key === "normal") item.classList.add("selected");

      Utils.safeAddListener(item, "click", (e) => {
        const prev = presetMenu.querySelector(".selected");
        if (prev) prev.classList.remove("selected");
        item.classList.add("selected");
        presetLabel.innerText = CONFIG.PRESETS[key].label || key;
        presetMenu.classList.remove("show");
        Storage.saveSettings({ fileSizePreset: key });
      });
      presetMenu.appendChild(item);
    }

    Utils.safeAddListener(presetToggle, "click", (e) => {
      e.stopPropagation();
      presetMenu.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (presetRoot && !presetRoot.contains(e.target)) {
        presetMenu.classList.remove("show");
      }
    });


    const simpleToggle = Utils.safeGetElement("mgkSimpleMode");
    function updateModeUI() {
      const simple = simpleToggle?.checked ?? true;
      const modeLabel = Utils.safeGetElement("mgkModeLabel");
      if (modeLabel) modeLabel.innerText = simple ? "Mode: Simple" : "Mode: Advanced";

      const simplified = Utils.safeGetElement("mgkSimplifiedArea");
      const advanced = Utils.safeGetElement("mgkAdvancedArea");

      if (simplified && advanced) {
        if (simple) {
          simplified.style.display = "block";
          advanced.style.display = "none";
        } else {
          simplified.style.display = "none";
          advanced.style.display = "block";
        }
      }
    }

    if (simpleToggle) {
      Utils.safeAddListener(simpleToggle, "change", () => {
        updateModeUI();
        Storage.saveSettings({ simpleMode: simpleToggle.checked });
      });
    }
    updateModeUI();


    Utils.safeAddListener(Utils.safeGetElement("mgkOpenMappingsBtn"), "click", () => {
      MappingModal.open();
    });
  },

  showMainModal: () => {
    const backdrop = Utils.safeGetElement("mgkModalBackdrop");
    const modal = Utils.safeGetElement(CONFIG.MODAL_ID);
    if (backdrop && modal) {
      backdrop.style.display = "flex";
      requestAnimationFrame(() => modal.classList.add("show"));
    }
  },

  hideMainModal: () => {
    const backdrop = Utils.safeGetElement("mgkModalBackdrop");
    const modal = Utils.safeGetElement(CONFIG.MODAL_ID);
    if (modal) {
      modal.classList.remove("show");
      setTimeout(() => {
        if (backdrop) backdrop.style.display = "none";
      }, 400);
    }
  },

  populateDeckListAndWire: (decks, currentLanguage) => {
    const listEl = Utils.safeGetElement("mgkDeckList");
    const searchEl = Utils.safeGetElement("mgkDeckSearch");
    const hidden = Utils.safeGetElement("mgkDeckSelectHidden");
    const badge = Utils.safeGetElement("mgkSelectedBadge");
    if (!listEl || !searchEl || !badge) return;

    const items = decks.filter(d => !d.del).map(d => ({
      id: d.id,
      name: d.name,
      lang: d.lang
    }));
    let selected = new Set();

    function updateBadgeAndHidden() {
      if (selected.size === 0) {
        badge.innerText = "No deck selected";
      } else if (selected.size === 1) {
        const id = Array.from(selected)[0];
        const found = items.find(x => String(x.id) === String(id));
        badge.innerText = found ? found.name : `${selected.size} selected`;
      } else {
        badge.innerText = `${selected.size} decks selected`;
      }
      if (hidden) hidden.value = Array.from(selected).join(",");
    }

    function render(filter = "") {
      listEl.innerHTML = "";
      const q = (filter || "").toLowerCase().trim();
      const filtered = items.filter(it => it.name.toLowerCase().includes(q));

      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="mgk-small" style="padding:16px;color:var(--text-muted);text-align:center;">No decks found</div>`;
        return;
      }


      const decksByLang = {};
      filtered.forEach(deck => {
        const lang = deck.lang || 'Unknown';
        if (!decksByLang[lang]) decksByLang[lang] = [];
        decksByLang[lang].push(deck);
      });


      const sortedLanguages = Object.keys(decksByLang).sort();


      sortedLanguages.forEach(language => {

        const header = document.createElement("div");
        header.style.cssText = `
          padding: 12px 16px;
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--accent);
          border-bottom: 1px solid var(--border);
          margin-bottom: 6px;
          background: var(--secondary-bg);
          border-radius: 8px;
        `;
        header.textContent = language;
        listEl.appendChild(header);


        decksByLang[language].forEach(deck => {
          const li = document.createElement("div");
          li.className = "mgk-list-inner-item";
          li.tabIndex = 0;
          li.dataset.deckId = deck.id;
          li.dataset.language = deck.lang;
          li.style.marginLeft = "12px";
          li.innerText = deck.name;
          if (selected.has(String(deck.id))) li.classList.add("selected");

          Utils.safeAddListener(li, "click", () => {
            const idStr = String(deck.id);
            if (selected.has(idStr)) {
              selected.delete(idStr);
              li.classList.remove("selected");
            } else {
              selected.add(idStr);
              li.classList.add("selected");
            }
            updateBadgeAndHidden();
          });

          Utils.safeAddListener(li, "keydown", (ev) => {
            if (ev.key === "Enter") li.click();
            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              const next = li.nextElementSibling;
              if (next && next.classList.contains('mgk-list-inner-item')) {
                next.focus();
              }
            }
            if (ev.key === "ArrowUp") {
              ev.preventDefault();
              const prev = li.previousElementSibling;
              if (prev && prev.classList.contains('mgk-list-inner-item')) {
                prev.focus();
              }
            }
          });

          listEl.appendChild(li);
        });
      });
    }

    render("");

    let open = false;
    async function toggleList(show) {
      if (show === undefined) show = !open;
      open = show;
      if (open) {
        listEl.style.setProperty('display', 'block');
        listEl.style.position = 'absolute';
        listEl.style.visibility = 'hidden';
        await new Promise(r => requestAnimationFrame(r));
        let measured = listEl.scrollHeight || 280;
        const maxH = 360;
        if (measured > maxH) measured = maxH;
        listEl.style.position = '';
        listEl.style.visibility = '';
        listEl.style.setProperty('--mgk-list-height', `${measured}px`);
        listEl.classList.add('show');
      } else {
        listEl.classList.remove('show');
        setTimeout(() => {
          listEl.style.removeProperty('--mgk-list-height');
          listEl.style.display = '';
        }, 300);
      }
    }

    if (searchEl) {
      searchEl.onfocus = () => toggleList(true);
      searchEl.oninput = (e) => {
        render(e.target.value);
        toggleList(true);
      };
      searchEl.onkeydown = (e) => {
        if (e.key === "ArrowDown") {
          const first = listEl.querySelector(".mgk-list-inner-item");
          if (first) first.focus();
        } else if (e.key === "Escape") {
          toggleList(false);
        }
      };
    }

    document.addEventListener("click", (e) => {
      const root = Utils.safeGetElement("mgkDeckList")?.parentElement;
      if (!root) return;
      if (!root.contains(e.target)) toggleList(false);
    }, { capture: true });

    window.migakuDropdown = {
      items,
      selected,
      selectAll: () => {
        items.forEach(it => selected.add(String(it.id)));
        render(searchEl?.value || "");
        updateBadgeAndHidden();
      },
      clear: () => {
        selected.clear();
        render(searchEl?.value || "");
        updateBadgeAndHidden();
      }
    };
  },

  destroyUI: () => {
    const fab = Utils.safeGetElement(CONFIG.FAB_ID);
    const fabMenu = Utils.safeGetElement("mgkFabMenu");

    if (fab && fab.parentNode) {
      fab.parentNode.removeChild(fab);
    }
    if (fabMenu && fabMenu.parentNode) {
      fabMenu.parentNode.removeChild(fabMenu);
    }
  }
};

// Route monitoring (copied from stats.js pattern)
function handleRouteChange() {
  const isRootPath = window.location.pathname === '/' || window.location.pathname === '';

  if (isRootPath) {
    UI.createMainUI();
  } else {
    UI.destroyUI();
  }
}

function setupRouteListener() {
  // popstate and hashchange work in content scripts
  window.addEventListener("popstate", handleRouteChange);
  window.addEventListener("hashchange", handleRouteChange);

  // Listen for route changes detected by the service worker via webNavigation API
  // (replaces monkey-patched history.pushState/replaceState which doesn't work from content scripts)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "routeChanged") {
      handleRouteChange();
    }
  });
}

// Main init function
let globalSqlDbHandle = null;

async function initializeMigakuExporter() {
  try {
    Utils.log("Initializing Migaku Exporter...");

    await new Promise((resolve) => {
      const checkForApp = () => {
        if (document.querySelector(".HomeDecks") || document.querySelector("main.MIGAKU-SRS")) {
          resolve();
        } else {
          setTimeout(checkForApp, 500);
        }
      };
      checkForApp();
    });

    let SQL;
    try {
      const wasmUrl = chrome.runtime.getURL("lib/sql-wasm.wasm");
      const resp = await fetch(wasmUrl);
      if (!resp.ok) throw new Error("Failed to fetch sql-wasm resource: " + resp.status);
      const wasmBinary = await resp.arrayBuffer();
      SQL = await initSqlJs({ wasmBinary });
    } catch (e) {
      console.warn("WASM init with wasmBinary failed, falling back", e);
      SQL = await initSqlJs({
        locateFile: () => chrome.runtime.getURL("lib/sql-wasm.wasm")
      });
    }

    window._mgkSqlJs = SQL;

    // load the main database
    const raw = await DatabaseOps.loadRawSrsDatabaseBlob();
    if (!raw) {
      Utils.setStatus("Unable to open Migaku DB (srs). Make sure the site is loaded.", "#ef4444");
      return;
    }

    globalSqlDbHandle = new SQL.Database(raw);
    window._mgkSqlDbHandle = globalSqlDbHandle;

    // Setup route monitoring
    setupRouteListener();
    handleRouteChange();

    MigakuGPT.init();

    // populate deck list
    const decks = DatabaseOps.listDecks(globalSqlDbHandle);
    const lang = Utils.safeGetElement("main.MIGAKU-SRS")?.getAttribute?.("data-mgk-lang-selected") || null;
    UI.populateDeckListAndWire(decks, lang);

    // default export settings
    const settings = {
      simpleMode: true,
      includeImages: true,
      includeAudio: true,
      keepSyntax: false,
      convertMedia: false,
      enableImageConversion: true,
      imageMaxDimension: 1024,
      imageQuality: 0.85,
      enableAudioConversion: true,
      audioSampleRate: 22050,
      maxMediaSizeMB: 10,
      mergeSelected: false,
      useTemplates: true,
      fileSizePreset: "normal",
      ...Storage.loadSettings()
    };


    const applyToCheckbox = (id, value) => {
      const el = Utils.safeGetElement(id);
      if (el && el.type === "checkbox") el.checked = !!value;
    };
    const applyToInput = (id, value) => {
      const el = Utils.safeGetElement(id);
      if (el) el.value = value;
    };

    applyToCheckbox("mgkSimpleMode", settings.simpleMode);
    applyToCheckbox("mgkIncludeImages", settings.includeImages);
    applyToCheckbox("mgkIncludeAudio", settings.includeAudio);
    applyToCheckbox("mgkKeepSyntax", settings.keepSyntax);
    applyToCheckbox("mgkConvertMedia", settings.convertMedia);
    applyToInput("mgkImageMaxDim", settings.imageMaxDimension || 1024);
    applyToInput("mgkImageQuality", settings.imageQuality || 0.85);
    applyToInput("mgkAudioSampleRate", settings.audioSampleRate || 22050);
    applyToInput("mgkMaxMediaSize", settings.maxMediaSizeMB || 10);
    applyToCheckbox("mgkMergeSelected", settings.mergeSelected);
    applyToCheckbox("mgkUseTemplates", settings.useTemplates);


    Utils.safeAddListener(Utils.safeGetElement("mgkExportDeckBtn"), "click", async () => {
      const hidden = Utils.safeGetElement("mgkDeckSelectHidden");
      const selCsv = hidden?.value || "";
      if (!selCsv) {
        Utils.setStatus("No deck selected", "#ef4444");
        return;
      }

      const ids = selCsv.split(",").map(s => s.trim()).filter(Boolean);
      if (ids.length === 0) {
        Utils.setStatus("No deck selected", "#ef4444");
        return;
      }

      const simple = Utils.safeGetElement("mgkSimpleMode")?.checked ?? true;
      let opts = {};
      const keepSyntax = Utils.safeGetElement("mgkKeepSyntax")?.checked ?? false;
      const includeImages = Utils.safeGetElement("mgkIncludeImages")?.checked ?? true;
      const includeAudio = Utils.safeGetElement("mgkIncludeAudio")?.checked ?? true;

      if (simple) {
        const presetMenu = Utils.safeGetElement("mgkPresetMenu");
        const sel = presetMenu?.querySelector(".mgk-preset-item.selected")?.dataset?.preset || "normal";
        const mapping = CONFIG.PRESETS[sel] || CONFIG.PRESETS.normal;
        opts = {
          includeMedia: (includeImages || includeAudio),
          includeImages,
          includeAudio,
          keepSyntax,
          convertMedia: mapping.enableImageConversion || mapping.enableAudioConversion,
          enableImageConversion: mapping.enableImageConversion,
          imageMaxDimension: mapping.imageMaxDimension,
          imageQuality: mapping.imageQuality,
          enableAudioConversion: mapping.enableAudioConversion,
          audioSampleRate: mapping.audioSampleRate,
          maxMediaSizeBytes: (mapping.maxMediaSizeMB || 10) * 1024 * 1024,
          mergeSelected: Utils.safeGetElement("mgkMergeSelected")?.checked ?? false,
          useTemplates: Utils.safeGetElement("mgkUseTemplates")?.checked ?? true,
          mediaWorkerCount: 5
        };
      } else {
        opts = {
          includeMedia: (includeImages || includeAudio),
          includeImages,
          includeAudio,
          keepSyntax,
          convertMedia: Utils.safeGetElement("mgkConvertMedia")?.checked ?? false,
          enableImageConversion: true,
          imageMaxDimension: parseInt(Utils.safeGetElement("mgkImageMaxDim")?.value || "1024"),
          imageQuality: parseFloat(Utils.safeGetElement("mgkImageQuality")?.value || "0.85"),
          enableAudioConversion: true,
          audioSampleRate: parseInt(Utils.safeGetElement("mgkAudioSampleRate")?.value || "22050"),
          maxMediaSizeBytes: (parseFloat(Utils.safeGetElement("mgkMaxMediaSize")?.value || "10") || 10) * 1024 * 1024,
          mergeSelected: Utils.safeGetElement("mgkMergeSelected")?.checked ?? false,
          useTemplates: Utils.safeGetElement("mgkUseTemplates")?.checked ?? true,
          mediaWorkerCount: 5
        };
      }

      // save settings to localStorage
      Storage.saveSettings({
        simpleMode: simple,
        includeImages: opts.includeImages,
        includeAudio: opts.includeAudio,
        keepSyntax: opts.keepSyntax,
        convertMedia: opts.convertMedia,
        enableImageConversion: opts.enableImageConversion,
        imageMaxDimension: opts.imageMaxDimension,
        imageQuality: opts.imageQuality,
        enableAudioConversion: opts.enableAudioConversion,
        audioSampleRate: opts.audioSampleRate,
        maxMediaSizeMB: (opts.maxMediaSizeBytes || 0) / (1024 * 1024),
        mergeSelected: opts.mergeSelected,
        useTemplates: opts.useTemplates,
        fileSizePreset: Utils.safeGetElement("mgkPresetMenu")?.querySelector(".mgk-preset-item.selected")?.dataset?.preset || "normal"
      });

      Utils.setStatus("Starting export(s)...", "#f59e0b");
      Progress.show("Starting...", 0);

      const mappings = Storage.loadMappings();
      try {
        await ExportProcessor.buildApkgsForSelection(
          window._mgkSqlJs,
          globalSqlDbHandle,
          ids,
          DatabaseOps.listDecks(globalSqlDbHandle),
          opts,
          mappings
        );
        Utils.setStatus("Exports completed successfully!", "#10b981");
      } catch (e) {
        console.error("Export failed", e);
        Utils.setStatus("Export failed – see console for details", "#ef4444");
      }
      Progress.hide();
    });

    Utils.safeAddListener(Utils.safeGetElement("mgkExportWordlistBtn"), "click", async () => {
      let useLang = lang || Utils.safeGetElement("main.MIGAKU-SRS")?.getAttribute?.("data-mgk-lang-selected") || null;

      // If still no language, try to get it from the decks
      if (!useLang && globalSqlDbHandle) {
        const decks = DatabaseOps.listDecks(globalSqlDbHandle);
        const activeDeck = decks.find(d => !d.del && d.lang);
        if (activeDeck) {
          useLang = activeDeck.lang;
          Utils.log(`Using language from deck: ${useLang}`);
        }
      }

      Utils.setStatus("Exporting wordlists...", "#f59e0b");
      await ExportProcessor.exportWordlists(globalSqlDbHandle, useLang);
    });


    Utils.setStatus("Migaku Exporter loaded successfully!", "#10b981");
    Utils.log("Initialization complete");

  } catch (error) {
    console.error("[MGK] Initialization failed:", error);
    Utils.setStatus("Initialization failed - check console for details", "#ef4444");
  }
}


// global error handling


window.addEventListener('error', (event) => {
  console.error('[MGK] Global error caught:', event.error);
  Utils.setStatus("An error occurred - check console", "#ef4444");
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[MGK] Unhandled promise rejection:', event.reason);
  Utils.setStatus("Promise rejection - check console", "#ef4444");
});

// debug stuff - expose on window so I can mess with it in console
window.migakuExporterV3 = {
  Utils,
  Storage,
  Progress,
  MediaProcessor,
  FirebaseAuth,
  DatabaseOps,
  FieldMapper,
  AnkiBuilder,
  MigakuGPT,
  MediaHandler,
  ExportProcessor,
  UI,
  MappingModal,
  DeckProtection,
  initializeMigakuExporter,
  CONFIG
};

window.MigakuGPT = MigakuGPT;

// startup + recovery logic (in case migaku's page loads weird)
(function robustMigakuLauncher() {

  window.addEventListener('error', (event) => {
    console.error('[MGK] Global error:', event.error);
  });

  window.migakuExporter = window.migakuExporterV3;

  let recoveryAttempts = 0;
  const maxRecoveryAttempts = 30;

  const tryInitialization = async () => {
    try {
      await initializeMigakuExporter();
      Utils.log("initialized successfully");
    } catch (err) {
      console.error("[MGK] Initialization failed:", err);
      Utils.setStatus("Initialization failed - attempting recovery...", "#ef4444");

      // Try to recover by checking if UI exists and recreating if needed
      const recoveryInterval = setInterval(() => {
        recoveryAttempts++;

        try {
          if (!Utils.safeGetElement(CONFIG.FAB_ID)) {
            try {
              UI.createMainUI();
              Utils.log(`[MGK] UI created by recovery (attempt ${recoveryAttempts})`);
            } catch(e) {
              console.error("[MGK] UI creation failed during recovery", e);
            }
          }

          if (Utils.safeGetElement(CONFIG.FAB_ID)) {
            Utils.log("Recovery successful - UI is present");
            Utils.setStatus("Initialized (recovered)", "#f59e0b");
            clearInterval(recoveryInterval);
          }
        } catch(e) {
          console.error("[MGK] Recovery attempt failed", e);
        }

        if (recoveryAttempts >= maxRecoveryAttempts) {
          console.warn(`[MGK] Recovery abandoned after ${recoveryAttempts} attempts`);
          Utils.setStatus("Recovery failed - try refreshing the page", "#ef4444");
          clearInterval(recoveryInterval);
        }
      }, 500);
    }
  };

  tryInitialization();

})();

(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const attributes = ["src", "srcset", "data-src", "data-thumb"];
  const states = new Map();
  const pending = new Set();
  let enabled = true;
  let scheduled = false;

  function videoID(value) {
    // Only video-thumbnail CDN paths, never avatars or arbitrary external images.
    for (const token of value?.split(/[\s,]+/) ?? []) {
      let url;
      try { url = new URL(token); } catch { continue; }
      if (url.protocol !== "https:" || !/^(?:i\d?\.ytimg\.com|img\.youtube\.com)$/.test(url.hostname)) continue;
      const id = url.pathname.match(/^\/(?:vi|vi_webp|an_webp)\/([\w-]{11})\//)?.[1];
      if (id) return id;
    }
    return null;
  }

  function remember(element, names) {
    return {
      element,
      original: new Map(names.map(name => [name, element.getAttribute(name)])),
      applied: new Map()
    };
  }

  function capture(record) {
    const changed = [];
    for (const [name, original] of record.original) {
      const current = record.element.getAttribute(name);
      if (!record.applied.has(name) || current !== record.applied.get(name)) {
        if (current !== original) changed.push([name, current]);
        record.original.set(name, current);
      }
    }
    return changed;
  }

  function set(record, name, value) {
    record.applied.set(name, value);
    if (record.element.getAttribute(name) === value) return;
    if (value === null) record.element.removeAttribute(name);
    else record.element.setAttribute(name, value);
  }

  function restore(record) {
    capture(record);
    for (const [name, value] of record.original) set(record, name, value);
    record.applied.clear();
  }

  function update(img) {
    let state = states.get(img);
    const changed = state ? capture(state.image) : [];
    let id = state?.id ?? ["srcset", "src", "data-src", "data-thumb"].map(name => videoID(img.getAttribute(name))).find(Boolean);
    const changedID = changed.map(([, value]) => videoID(value)).find(Boolean);
    if (changedID) id = changedID;
    else if (changed.some(([name, value]) => name === "src" && value !== null)) id = null;

    // Picture sources can be removed or moved independently of their image.
    const sources = new Set(img.closest("picture")?.querySelectorAll("source") ?? []);
    if (state) for (const [source, record] of state.sources) {
      if (!sources.has(source)) {
        restore(record);
        state.sources.delete(source);
      }
    }

    if (!enabled || !img.isConnected || !id) {
      if (state) {
        restore(state.image);
        for (const source of state.sources.values()) restore(source);
        img.removeEventListener("error", state.onError);
        img.removeEventListener("load", state.onLoad);
        states.delete(img);
      }
      return;
    }

    if (!state) {
      state = { image: remember(img, attributes), sources: new Map(), id, quality: 0 };
      state.onError = () => {
        if (!states.has(img) || !enabled) return;
        if (state.quality < 2) {
          state.quality++;
          queue(img);
        } else {
          // No generated frame exists (for example, an upcoming live stream).
          // Restore the creator image, and retry only when this card changes video.
          state.unavailable = true;
          queue(img);
        }
      };
      state.onLoad = () => {
        // Some missing CDN variants return a tiny placeholder with HTTP 200.
        if (state.quality < 2 && img.naturalWidth > 0 && img.naturalWidth <= 120) state.onError();
      };
      img.addEventListener("error", state.onError);
      img.addEventListener("load", state.onLoad);
      states.set(img, state);
    }
    if (state.id !== id) {
      state.id = id;
      state.quality = 0;
      state.unavailable = false;
    }
    if (state.unavailable) {
      restore(state.image);
      for (const source of state.sources.values()) restore(source);
      return;
    }

    for (const source of sources) {
      if (!state.sources.has(source)) state.sources.set(source, remember(source, ["srcset"]));
      const record = state.sources.get(source);
      capture(record);
      set(record, "srcset", null);
    }
    const filename = ["maxres2.jpg", "hq2.jpg", "2.jpg"][state.quality];
    set(state.image, "src", `https://i.ytimg.com/vi/${id}/${filename}`);
    for (const name of attributes.slice(1)) set(state.image, name, null);
  }

  function queue(img) {
    pending.add(img);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const batch = [...pending];
      pending.clear();
      for (const image of batch) update(image);
    });
  }

  function collect(root) {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.matches?.("img")) queue(root);
    for (const img of root.querySelectorAll("img")) queue(img);
    // A source element can be inserted into an existing picture.
    const image = root.closest?.("picture")?.querySelector("img");
    if (image) queue(image);
  }

  function refresh() {
    for (const img of states.keys()) queue(img);
    if (enabled) collect(document);
  }

  const observer = new MutationObserver(records => {
    let removed = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const img = record.target.matches("img") ? record.target : record.target.closest("picture")?.querySelector("img");
        if (img) queue(img);
      } else {
        const pictureImage = record.target.closest?.("picture")?.querySelector("img");
        if (pictureImage) queue(pictureImage);
        for (const node of record.addedNodes) collect(node);
        if (record.removedNodes.length) for (const img of states.keys()) {
          if ([...record.removedNodes].some(node => node === img || node.contains(img))) queue(img);
        }
        removed ||= record.removedNodes.length > 0;
      }
    }
    if (removed) for (const img of states.keys()) if (!img.isConnected) queue(img);
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.middleEnabled) return;
    enabled = changes.middleEnabled.newValue !== false;
    refresh();
  });

  api.storage.local.get({ middleEnabled: true }).then(settings => {
    enabled = settings.middleEnabled;
    observer.observe(document, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: attributes
    });
    refresh();
  }).catch(error => console.error("YouTube Middle could not load its setting:", error));
})();

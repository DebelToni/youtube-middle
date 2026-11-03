"use strict";
const api = globalThis.browser ?? globalThis.chrome;
const fieldset = document.querySelector("fieldset");
const error = document.querySelector("#error");

function select(enabled) {
  document.querySelector(`input[value="${enabled ? "middle" : "original"}"]`).checked = true;
}

api.storage.local.get({ middleEnabled: true }).then(settings => {
  select(settings.middleEnabled);
  fieldset.disabled = false;
}).catch(() => { error.hidden = false; });

fieldset.addEventListener("change", async event => {
  error.hidden = true;
  fieldset.disabled = true;
  try {
    await api.storage.local.set({ middleEnabled: event.target.value === "middle" });
  } catch {
    error.hidden = false;
  } finally {
    try {
      const settings = await api.storage.local.get({ middleEnabled: true });
      select(settings.middleEnabled);
    } catch {
      error.hidden = false;
    } finally {
      fieldset.disabled = false;
    }
  }
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.middleEnabled) select(changes.middleEnabled.newValue !== false);
});

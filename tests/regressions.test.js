import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const script = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const A = 'dQw4w9WgXcQ', B = 'jNQXAC9IVRw';
const src = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

async function run(html) {
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
  let listener;
  dom.window.browser = { storage: { local: { get: async () => ({ middleEnabled: true }) }, onChanged: { addListener: fn => { listener = fn; } } } };
  dom.window.eval(script);
  await tick();
  return { dom, doc: dom.window.document, toggle: async value => { listener({ middleEnabled: { newValue: value } }, 'local'); await tick(); } };
}

for (const attribute of ['srcset', 'data-src', 'data-thumb']) {
  test(`recycling through ${attribute} retains the new ID on subsequent mutations`, async () => {
    const { dom, doc, toggle } = await run(`<img src="${src(A)}">`);
    const img = doc.querySelector('img');
    img.setAttribute(attribute, src(B));
    await tick();
    await tick();
    assert.equal(img.src, `https://i.ytimg.com/vi/${B}/maxres2.jpg`);
    if (attribute === 'srcset') {
      await toggle(false);
      await toggle(true);
      assert.equal(img.src, `https://i.ytimg.com/vi/${B}/maxres2.jpg`);
    }
    dom.window.close();
  });
}

test('moving image out of picture restores old picture source', async () => {
  const { dom, doc } = await run(`<picture><source srcset="${src(A)}"><img src="${src(A)}"></picture>`);
  const img = doc.querySelector('img'), source = doc.querySelector('source');
  assert.equal(source.getAttribute('srcset'), null);
  doc.body.append(img);
  await tick();
  assert.equal(source.srcset, src(A));
  dom.window.close();
});

test('external URL containing a YouTube CDN URL is not a thumbnail', async () => {
  const external = `https://example.com/?url=${src(A)}`;
  const { dom, doc } = await run(`<img src="${external}">`);
  assert.equal(doc.querySelector('img').src, external);
  dom.window.close();
});

test('popup remains usable if a post-save storage read fails', async () => {
  const dom = new JSDOM(await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' });
  let calls = 0;
  dom.window.browser = { storage: {
    local: {
      get: async () => { if (++calls > 1) throw new Error('read failure'); return { middleEnabled: true }; },
      set: async () => {}
    }, onChanged: { addListener() {} }
  } };
  dom.window.eval(await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'));
  await tick();
  dom.window.document.querySelector('input[value="original"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(dom.window.document.querySelector('fieldset').disabled, false);
  assert.equal(dom.window.document.querySelector('#error').hidden, false);
  dom.window.close();
});

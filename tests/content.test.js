import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const script = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const A = 'dQw4w9WgXcQ';
const B = 'jNQXAC9IVRw';
const original = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg?x=1`;
const middle = (id, quality = 'maxres2') => `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function setup(html, enabled = true) {
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
  let listener;
  dom.window.browser = { storage: {
    local: { get: async () => ({ middleEnabled: enabled }) },
    onChanged: { addListener: fn => { listener = fn; } }
  } };
  dom.window.eval(script);
  await tick();
  return {
    window: dom.window, document: dom.window.document,
    async toggle(value) {
      enabled = value;
      listener({ middleEnabled: { newValue: value } }, 'local');
      await tick();
    },
    close: () => dom.window.close()
  };
}

test('middle is default; toggle restores exact original src, srcset and lazy attributes', async () => {
  const env = await setup(`<img src="${original(A)}" srcset="${original(A)} 2x" data-thumb="${original(A)}">`);
  const img = env.document.querySelector('img');
  assert.equal(img.getAttribute('src'), middle(A));
  assert.equal(img.getAttribute('srcset'), null);
  assert.equal(img.getAttribute('data-thumb'), null);
  await env.toggle(false);
  assert.equal(img.getAttribute('src'), original(A));
  assert.equal(img.getAttribute('srcset'), `${original(A)} 2x`);
  assert.equal(img.getAttribute('data-thumb'), original(A));
  await env.toggle(true);
  assert.equal(img.getAttribute('src'), middle(A));
  env.close();
});

test('initial original mode, avatars and external images are untouched', async () => {
  const env = await setup(`<img id="video" src="${original(A)}"><img id="avatar" src="https://yt3.ggpht.com/avatar"><img id="external" src="https://example.com/vi/${A}/x.jpg">`, false);
  assert.equal(env.document.querySelector('#video').src, original(A));
  await env.toggle(true);
  assert.equal(env.document.querySelector('#video').src, middle(A));
  assert.equal(env.document.querySelector('#avatar').src, 'https://yt3.ggpht.com/avatar');
  assert.equal(env.document.querySelector('#external').src, `https://example.com/vi/${A}/x.jpg`);
  env.close();
});

test('new cards, recycled image nodes, lazy writes and SPA navigation', async () => {
  const env = await setup('<main></main>');
  const img = env.document.createElement('img');
  img.src = original(A);
  env.document.querySelector('main').append(img);
  await tick();
  assert.equal(img.src, middle(A));
  img.src = original(B);
  img.srcset = `${original(B)} 2x`;
  await tick();
  assert.equal(img.src, middle(B));
  await env.toggle(false);
  assert.equal(img.src, original(B));
  assert.equal(img.srcset, `${original(B)} 2x`);
  img.src = original(A);
  img.removeAttribute('srcset');
  await env.toggle(true);
  assert.equal(img.src, middle(A));
  img.remove();
  await tick();
  assert.equal(img.src, original(A));
  env.document.body.append(img);
  await tick();
  assert.equal(img.src, middle(A));
  env.close();
});

test('picture sources cannot override the frame and restore on toggle', async () => {
  const env = await setup(`<picture><source srcset="${original(A)} 2x"><img src="${original(A)}"></picture>`);
  const source = env.document.querySelector('source');
  assert.equal(source.getAttribute('srcset'), null);
  source.srcset = `${original(B)} 3x`;
  await tick();
  assert.equal(source.getAttribute('srcset'), null);
  await env.toggle(false);
  assert.equal(source.srcset, `${original(B)} 3x`);
  env.close();
});

test('missing HD falls back to generated frames, then original; video change retries', async () => {
  const env = await setup(`<img src="${original(A)}">`);
  const img = env.document.querySelector('img');
  const fail = async () => { img.dispatchEvent(new env.window.Event('error')); await tick(); };
  await fail();
  assert.equal(img.src, middle(A, 'hq2'));
  await fail();
  assert.equal(img.src, middle(A, '2'));
  await fail();
  assert.equal(img.src, original(A));
  await tick();
  assert.equal(img.src, original(A));
  img.src = original(B);
  await tick();
  assert.equal(img.src, middle(B));
  env.close();
});

test('small CDN placeholder is treated as missing HD; WebP paths work', async () => {
  const env = await setup(`<img src="https://i.ytimg.com/vi_webp/${A}/hqdefault.webp">`);
  const img = env.document.querySelector('img');
  Object.defineProperty(img, 'naturalWidth', { value: 120 });
  img.dispatchEvent(new env.window.Event('load'));
  await tick();
  assert.equal(img.src, middle(A, 'hq2'));
  env.close();
});

test('changing a video thumbnail into a nonvideo image drops the replacement', async () => {
  const env = await setup(`<img src="${original(A)}">`);
  const img = env.document.querySelector('img');
  img.src = 'https://yt3.ggpht.com/avatar';
  await tick();
  assert.equal(img.src, 'https://yt3.ggpht.com/avatar');
  await env.toggle(false);
  assert.equal(img.src, 'https://yt3.ggpht.com/avatar');
  env.close();
});

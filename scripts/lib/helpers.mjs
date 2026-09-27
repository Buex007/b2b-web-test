// helpers.mjs — the reading half of the job.
//
// Jev decides where to click; it never reads content and never writes free
// text. In a B-end suite most of the real work is the opposite: read a table,
// check a message, confirm a value, catch a download. These helpers cover that
// half so a plan does not have to hand-roll page.evaluate every time.

export async function textOf(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText ?? el.textContent ?? "").trim() : null;
  }, selector);
}

export async function textsOf(page, selector, limit = 200) {
  return await page.evaluate(
    ({ sel, lim }) =>
      [...document.querySelectorAll(sel)]
        .slice(0, lim)
        .map((el) => (el.innerText ?? el.textContent ?? "").trim()),
    { sel: selector, lim: limit },
  );
}

export async function countOf(page, selector) {
  return await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
}

/** Current value of an input/textarea/select. */
export async function valueOf(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.value ?? null) : null;
  }, selector);
}

/** Rows of a table as arrays of cell text (header row included when present). */
export async function tableRows(page, selector, { limit = 200 } = {}) {
  return await page.evaluate(
    ({ sel, lim }) => {
      const table = document.querySelector(sel);
      if (!table) return null;
      const rows = [...table.querySelectorAll("tr")].slice(0, lim);
      return rows.map((tr) =>
        [...tr.querySelectorAll("th,td")].map((td) => (td.innerText ?? "").trim()),
      );
    },
    { sel: selector, lim: limit },
  );
}

/** True when a selector is present and visible. */
export async function visible(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }, selector);
}

/** Poll the page text until `needle` shows up (or the deadline passes). */
export async function waitForText(page, needle, { timeout = 15_000, interval = 300 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const hit = await page
      .evaluate((n) => (document.body?.innerText || "").includes(n), needle)
      .catch(() => false);
    if (hit) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(interval);
  }
}

/** Snapshot the visible text, clipped — handy as evidence for a verdict. */
export async function pageText(page, limit = 4000) {
  const t = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  return String(t).slice(0, limit);
}

/**
 * Run an action that triggers a download and capture the artifact.
 * `saveAs` should be an absolute path (usually inside the case record).
 */
export async function expectDownload(page, action, { saveAs, timeout = 30_000 } = {}) {
  const waiting = page.waitForEvent("download", { timeout });
  await action();
  const download = await waiting;
  const out = {
    url: download.url(),
    suggestedFilename: download.suggestedFilename?.(),
  };
  if (saveAs) {
    await download.saveAs(saveAs);
    out.savedAs = saveAs;
  }
  return out;
}

/** XHR/fetch responses with status >= 400 that the page made since last drain. */
export async function failedRequests(page) {
  return await page
    .evaluate(() => {
      const s = globalThis.__b2bCollector;
      if (!s) return [];
      const out = s.net.splice(0, s.net.length);
      return out;
    })
    .catch(() => []);
}

/** Compare the UI against the API that feeds it — the classic B-end bug. */
export async function apiJson(page, url, options) {
  const res = await page.fetch(url, options);
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(res.body) };
  } catch {
    return { ok: res.ok, status: res.status, json: null, body: res.body };
  }
}

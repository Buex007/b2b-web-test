// util.mjs — dependency-free helpers shared by every b2b-web-test library.
// Runs both inside the `ego-browser nodejs` runtime and under plain node.
//
// Portability rules enforced here:
//   * node built-ins are loaded with dynamic import (the ego runtime is a
//     long-lived Electron process; this is the documented access path)
//   * no path is ever derived from process.cwd() — inside the ego runtime the
//     cwd is always "/", so every caller must pass explicit absolute paths

export async function fs() {
  return await import("node:fs/promises");
}

export async function nodePath() {
  return await import("node:path");
}

/** Current time as ISO-8601 (local-timezone-agnostic, always sortable). */
export function nowIso(d = new Date()) {
  return d.toISOString();
}

const pad = (n) => String(n).padStart(2, "0");

/** "20260927-143210" — local time, used for human-facing stamps inside a record. */
export function stampCompact(d = new Date()) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Short random token; used to break ties in generated identifiers. */
export function shortId(len = 4) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  // crypto is available in both runtimes; fall back to Math.random.
  try {
    const bytes = new Uint8Array(len);
    // eslint-disable-next-line no-undef
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  } catch {
    for (let i = 0; i < len; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }
}

/**
 * Filesystem-safe name. CJK is preserved on purpose: the people using this
 * write their case descriptions in Chinese and macOS handles UTF-8 paths fine.
 */
export function slugify(input, { max = 40, fallback = "case" } = {}) {
  let s = String(input ?? "").trim().toLowerCase();
  // Dots become separators too, so a host like crm.example.com reads well in a
  // filename instead of collapsing into "crmexamplecom".
  s = s.replace(/[\s_/\\.]+/g, "-");
  s = s.replace(/[^0-9a-z\u4e00-\u9fff-]/g, "");
  s = s.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  if (!s) return fallback;
  if (s.length > max) s = s.slice(0, max).replace(/-+$/g, "");
  return s || fallback;
}

/** Redact anything that looks like a secret before it lands in a record. */
export function maskValue(v) {
  const s = String(v ?? "");
  if (!s) return "";
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}****${s.slice(-1)}`;
}

export async function ensureDir(dir) {
  const f = await fs();
  await f.mkdir(dir, { recursive: true });
  return dir;
}

export async function exists(p) {
  const f = await fs();
  try {
    await f.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function writeText(file, text) {
  const f = await fs();
  const path = await nodePath();
  await f.mkdir(path.dirname(file), { recursive: true });
  await f.writeFile(file, text, "utf8");
  return file;
}

export async function readText(file) {
  const f = await fs();
  return await f.readFile(file, "utf8");
}

export async function writeJson(file, value) {
  return await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readText(file));
  } catch {
    return fallback;
  }
}

export async function appendLine(file, value) {
  const f = await fs();
  const path = await nodePath();
  await f.mkdir(path.dirname(file), { recursive: true });
  const line = typeof value === "string" ? value : JSON.stringify(value);
  await f.appendFile(file, `${line}\n`, "utf8");
}

export async function readJsonl(file) {
  const out = [];
  try {
    const text = await readText(file);
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
        /* a partially written trailing line is not worth failing over */
      }
    }
  } catch {
    /* missing file == empty */
  }
  return out;
}

export async function listDirs(dir) {
  const f = await fs();
  const path = await nodePath();
  try {
    const entries = await f.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Regular files in a directory (sorted). Missing directory == empty list. */
export async function listFiles(dir) {
  const f = await fs();
  const path = await nodePath();
  try {
    const entries = await f.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Path of `to` relative to `from`, with forward slashes (for HTML links). */
export async function relPath(from, to) {
  const path = await nodePath();
  return path.relative(from, to).split(path.sep).join("/");
}

export function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compact human duration. */
export function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// session.mjs — TaskSpace and Page lifecycle.
//
// Test suites need the opposite of a one-shot task: the same browser session
// should survive across runs so that a login done once (including SSO/MFA,
// which no agent should attempt) is reused by every later case.
//
// So this module keeps a small registry of spaces keyed by environment, and
// resumes the recorded space when it is still alive. Cookies live in the
// browser profile anyway; the space is what keeps the *tab* (and any in-memory
// session state) alive between runs.
//
// Set B2B_SESSION=fresh to opt out and get a clean space per case.

import { readJson, writeJson, ensureDir, nowIso, slugify, nodePath, fs } from "./util.mjs";

/** Stable key for "the environment this case runs against". */
export function envSlugFor({ url, envName } = {}) {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  const base = [envName, host].filter(Boolean).join("-") || "default";
  return slugify(base, { max: 48, fallback: "default" });
}

export async function readSpaceRegistry({ dataDir, envSlug }) {
  const path = await nodePath();
  return await readJson(path.join(dataDir, "spaces", `${envSlug}.json`), null);
}

export async function writeSpaceRegistry({ dataDir, envSlug, value }) {
  const path = await nodePath();
  await ensureDir(path.join(dataDir, "spaces"));
  await writeJson(path.join(dataDir, "spaces", `${envSlug}.json`), value);
}

export async function forgetSpace({ dataDir, envSlug }) {
  const path = await nodePath();
  const f = await fs();
  try {
    await f.unlink(path.join(dataDir, "spaces", `${envSlug}.json`));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {string} o.envSlug
 * @param {string} o.url            entry URL (context only)
 * @param {string} o.name           space name used when creating a new space
 * @param {"reuse"|"fresh"} [o.mode]
 * @param {object} [o.recorder]     receives attach(page)
 */
export function createSession({ dataDir, envSlug, url, name, mode = "reuse", recorder = null }) {
  let task = null;
  let page = null;
  let spaceId = null;
  let reused = false;
  let handedOff = false;

  async function pickPage() {
    if (task.page) {
      try {
        return task.page("p1");
      } catch {
        /* p1 may have been closed since the space was recorded */
      }
    }
    const pages = (await task.pages?.()) || [];
    if (pages.length) return pages[0];
    return await task.newPage();
  }

  const session = {
    get task() {
      return task;
    },
    get page() {
      return page;
    },
    get spaceId() {
      return spaceId;
    },
    get reused() {
      return reused;
    },
    get handedOff() {
      return handedOff;
    },
    envSlug,

    /** Attach to the recorded space (or create one) and claim a Page. */
    async open({ adoptOnly = false } = {}) {
      if (task) {
        page = page ?? (await pickPage());
        return { task, page, spaceId, reused };
      }
      const registry = mode === "reuse" ? await readSpaceRegistry({ dataDir, envSlug }) : null;
      if (registry?.spaceId != null) {
        try {
          task = await taskSpace(registry.spaceId);
          spaceId = registry.spaceId;
          reused = true;
        } catch {
          task = null;
        }
      }
      if (!task && registry?.spaceId != null && registry?.spaceName) {
        // The recorded id is gone (browser restarted). Recreate under the same
        // name so the registry self-heals instead of piling up orphan names.
        task = await taskSpace(registry.spaceName);
        spaceId = task.spaceId;
        reused = false;
      }
      if (!task) {
        task = await taskSpace(name);
        spaceId = task.spaceId;
        reused = false;
      }
      page = await pickPage();
      await writeSpaceRegistry({
        dataDir,
        envSlug,
        value: {
          envSlug,
          spaceId,
          spaceName: registry?.spaceName || name,
          url: url || null,
          createdAt: registry?.createdAt || nowIso(),
          lastUsedAt: nowIso(),
        },
      });
      if (recorder) await recorder.attach(page);
      void adoptOnly;
      return { task, page, spaceId, reused };
    },

    /** Another managed page in the same space (e.g. a popup flow). */
    async use(label) {
      if (!task) await session.open();
      const p = task.page(label);
      page = p;
      if (recorder) await recorder.attach(p);
      return p;
    },

    /** Adopt a tab that was opened by the page (target=_blank). */
    async adoptActive() {
      if (!task) await session.open();
      const tabs = await task.tabs();
      const active = tabs.find((t) => t.active && !t.label);
      if (!active) return null;
      const p = await task.adopt(active.page);
      page = p;
      if (recorder) await recorder.attach(p);
      return p;
    },

    /** Hand the browser to the human (login / MFA / captcha) and stop. */
    async handoff(reason) {
      handedOff = true;
      if (recorder) await recorder.handoff(reason);
      if (task?.handOff) await task.handOff();
      return reason;
    },

    /** Close this space for good (next run starts clean). */
    async close({ keep = [] } = {}) {
      if (!task) return { closed: false };
      await task.finish({ keep });
      await forgetSpace({ dataDir, envSlug });
      task = null;
      page = null;
      spaceId = null;
      return { closed: true };
    },
  };

  return session;
}

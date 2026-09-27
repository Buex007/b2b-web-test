// collectors.mjs — in-page evidence collectors.
//
// Injected once per document and re-injected after every navigation (the
// injected state dies with the document). Everything is read back through
// page.evaluate(), so it works on any semantic page without CDP plumbing.
//
// Collected:
//   * uncaught errors and unhandled promise rejections
//   * console.error calls
//   * fetch / XHR responses with status >= 400 (or transport failures)

const FLAG = "__b2bCollector";

/**
 * Install (idempotently) the collector on the page's current document.
 * Safe to call before every step: it bails out if already installed.
 */
export async function installCollector(page) {
  try {
    return await page.evaluate(() => {
      const flag = "__b2bCollector";
      if (globalThis[flag]) return "already";
      const state = { errors: [], net: [], startedAt: Date.now() };
      globalThis[flag] = state;

      const push = (arr, item) => {
        if (arr.length < 200) arr.push(item);
      };

      addEventListener("error", (e) => {
        push(state.errors, {
          t: Date.now(),
          kind: "error",
          message: String(e?.message ?? e),
          source: e?.filename ? `${e.filename}:${e.lineno ?? ""}` : undefined,
        });
      });
      addEventListener("unhandledrejection", (e) => {
        push(state.errors, {
          t: Date.now(),
          kind: "unhandledrejection",
          message: String(e?.reason ?? e),
        });
      });

      const origError = console.error;
      console.error = function (...args) {
        push(state.errors, {
          t: Date.now(),
          kind: "console.error",
          message: args
            .map((a) => {
              try {
                return typeof a === "string" ? a : JSON.stringify(a);
              } catch {
                return String(a);
              }
            })
            .join(" "),
        });
        return origError.apply(console, args);
      };

      const origFetch = globalThis.fetch;
      if (typeof origFetch === "function") {
        globalThis.fetch = async function (...args) {
          const started = Date.now();
          let url = "";
          try {
            url = String(args[0]?.url ?? args[0] ?? "");
          } catch {
            url = "";
          }
          try {
            const res = await origFetch.apply(this, args);
            if (res && res.status >= 400) {
              push(state.net, {
                t: Date.now(),
                via: "fetch",
                url,
                status: res.status,
                ms: Date.now() - started,
              });
            }
            return res;
          } catch (err) {
            push(state.net, {
              t: Date.now(),
              via: "fetch",
              url,
              status: 0,
              error: String(err),
              ms: Date.now() - started,
            });
            throw err;
          }
        };
      }

      const XHR = globalThis.XMLHttpRequest;
      if (XHR?.prototype?.open && XHR?.prototype?.send) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url, ...rest) {
          try {
            this.__b2bReq = { method, url: String(url) };
          } catch {
            /* ignore */
          }
          return origOpen.call(this, method, url, ...rest);
        };
        XHR.prototype.send = function (...args) {
          const started = Date.now();
          this.addEventListener("loadend", () => {
            const status = Number(this.status);
            if (status === 0 || status >= 400) {
              push(state.net, {
                t: Date.now(),
                via: "xhr",
                method: this.__b2bReq?.method,
                url: String(this.__b2bReq?.url ?? ""),
                status,
                ms: Date.now() - started,
              });
            }
          });
          return origSend.apply(this, args);
        };
      }

      return "installed";
    });
  } catch {
    // A cross-origin frame, a closed page, or a document mid-navigation: the
    // collector is best-effort evidence, never a reason to fail a step.
    return "unavailable";
  }
}

/** Read and drain what the collector has seen since the last call. */
export async function drainCollector(page) {
  try {
    const res = await page.evaluate(() => {
      const state = globalThis.__b2bCollector;
      if (!state) return { errors: [], net: [], installed: false };
      const errors = state.errors.splice(0, state.errors.length);
      const net = state.net.splice(0, state.net.length);
      return { errors, net, installed: true };
    });
    // A page that answers with something unexpected (or nothing at all) must
    // never break evidence collection.
    if (!res || typeof res !== "object") return { errors: [], net: [], installed: false };
    return { errors: res.errors || [], net: res.net || [], installed: Boolean(res.installed) };
  } catch {
    return { errors: [], net: [], installed: false };
  }
}

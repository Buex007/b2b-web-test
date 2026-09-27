// jev.mjs — the fusion point.
//
// ego-browser supplies the primitives (TaskSpace/Page/snapshot/selector);
// the vendored Jev loop supplies the per-step "which element" decision. This
// wrapper adds what a test suite needs on top and nothing else:
//
//   * the decision backend is injected explicitly, so the runner never has to
//     discover keys through the filesystem or $HOME inside a runtime whose env
//     does not carry them
//   * the planner (which agent is driving) is injected for attribution
//   * every loop result is recorded into the case record automatically
//   * an optional mock decider makes the whole pipeline runnable offline

import { runJevLoop, formatTimings, makeAsk } from "../vendored/jev-loop.mjs";

export { formatTimings };

export function createJev({ secrets = {}, defaults = {}, recorder = null, getPage } = {}) {
  const mockAsk = defaults.mock ? defaults.mockAsk || null : null;

  const jev = {
    formatTimings,

    describe() {
      return mockAsk
        ? mockAsk.describe?.() || { backend: "mock", model: "mock" }
        : {
            backend: secrets.backend || "auto",
            model: secrets.model || null,
            keySource: secrets.source || null,
          };
    },

    /**
     * Run one decision loop. `opts` is upstream's options object; anything
     * omitted is filled from the case defaults, so callers can pass just
     * `{ goal, values, verify }`.
     */
    async run(opts = {}) {
      const page = opts.page || (getPage ? await getPage() : null);
      if (!page) throw new Error("jev.run: no page available");

      const call = { ...opts };
      delete call.page;

      if (call.maxSteps == null) call.maxSteps = defaults.maxSteps;
      if (call.planner == null) call.planner = defaults.planner;
      if (call.snapshotOptions == null && defaults.snapshotOptions) {
        call.snapshotOptions = defaults.snapshotOptions;
      }

      if (mockAsk) {
        if (call.ask == null) call.ask = mockAsk;
      } else {
        if (call.ask == null) {
          if (call.backend == null) call.backend = secrets.backend || undefined;
          if (call.apiKey == null) call.apiKey = secrets.apiKey || undefined;
          if (call.baseUrl == null) call.baseUrl = secrets.baseUrl || undefined;
          if (call.model == null) call.model = secrets.model || undefined;
        }
      }

      const result = await runJevLoop(page, call);
      if (recorder) await recorder.jev(result);
      return result;
    },

    /** Build a decider without running a loop (used by `b2b-test doctor`). */
    makeAsk(opts = {}) {
      return makeAsk({ ...opts, apiKey: opts.apiKey ?? secrets.apiKey, baseUrl: opts.baseUrl ?? secrets.baseUrl, backend: opts.backend ?? secrets.backend });
    },
  };

  return jev;
}

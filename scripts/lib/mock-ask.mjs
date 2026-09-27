// mock-ask.mjs — offline deciders so the whole pipeline can be exercised
// without a network call or an API key.
//
// Two shapes:
//   scriptedAsk([...])  exact script, mirrors the upstream selftest
//   autoFormAsk()       pragmatic: fill empty fields, submit, then done
//
// The answer object is the contract `runJevLoop` expects:
//   { op:{choice,confidence}, target_click|target_fill|target_select|target_scroll:
//     {choice,confidence}, value_key:{choice,confidence}, done:{noul}, stuck:{noul} }

function answerBase() {
  return {
    op: { choice: "escalate", confidence: 0.9 },
    target_click: { choice: "none", confidence: 0.9 },
    target_fill: { choice: "none", confidence: 0.9 },
    target_select: { choice: "none", confidence: 0.9 },
    target_scroll: { choice: "none", confidence: 0.9 },
    done: { noul: 0.01 },
    stuck: { noul: 0.01 },
  };
}

/** Deterministic script: [{op, match?, key?}] ending in done/escalate. */
export function scriptedAsk(script) {
  let cursor = 0;
  const ask = async (state) => {
    const step = script[cursor++] || { op: "escalate" };
    const a = answerBase();
    a.op = { choice: step.op, confidence: 0.9 };
    if (step.op === "done") a.done = { noul: 0.95 };
    const hit =
      step.match && state.elements.find((e) => step.match.test(`${e.name} ${e.in ?? ""}`));
    if (hit) {
      a[`target_${step.op}`] = { choice: String(hit.id), confidence: 0.9 };
    }
    if (step.key) a.value_key = { choice: step.key, confidence: 0.9 };
    if (!a.value_key && Object.keys(state.values || {}).length === 1) {
      a.value_key = { choice: Object.keys(state.values)[0], confidence: 0.9 };
    }
    return a;
  };
  ask.describe = () => ({ backend: "mock", model: "mock-jev/scripted" });
  return ask;
}

/**
 * Generic form filler: fills every empty eligible field (cycling the provided
 * values), then clicks something matching `submit`, then reports done.
 * Good enough for a self-check fixture; never used for real runs.
 */
export function autoFormAsk({ submit = /submit|提交|保存|登录|查询|search/i } = {}) {
  let submitted = false;
  const filled = new Set();
  const ask = async (state) => {
    const a = answerBase();
    const values = Object.entries(state.values || {});
    const els = state.elements || [];

    const fillable = els.filter(
      (e) => /textbox|searchbox|spinbutton|^dom:(input|textarea)$/.test(String(e.role)) &&
        e.actionable !== false,
    );
    // Track what we already filled: the loop re-snapshots every step, so a
    // purely "is this field empty" rule can never terminate.
    const target = fillable.find((e) => !filled.has(String(e.id)));
    if (values.length && target) {
      filled.add(String(target.id));
      const key = values[(filled.size - 1) % values.length][0];
      a.op = { choice: "fill", confidence: 0.9 };
      a.target_fill = { choice: String(target.id), confidence: 0.9 };
      a.value_key = { choice: key, confidence: 0.9 };
      return a;
    }

    const button = els.find((e) => e.actionable !== false && submit.test(String(e.name)));
    if (button && !submitted) {
      submitted = true;
      a.op = { choice: "click", confidence: 0.9 };
      a.target_click = { choice: String(button.id), confidence: 0.9 };
      return a;
    }

    a.op = { choice: "done", confidence: 0.9 };
    a.done = { noul: 0.95 };
    return a;
  };
  ask.describe = () => ({ backend: "mock", model: "mock-jev/autoform" });
  return ask;
}

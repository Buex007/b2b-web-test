// harness.mjs — tiny zero-dependency test harness.
//
// Deliberately not node:test or vitest: the tests must run inside the ego
// runtime (which is the runtime the tool actually uses) and on a machine whose
// shell has no node at all. A 40-line harness has no such ambiguity.

const registered = [];

export function test(name, fn) {
  registered.push({ name, fn });
}

/** Total number of registered tests — lets the docs assert their own claim. */
export function testCount() {
  return registered.length;
}

export function assert(cond, message = "assertion failed") {
  if (!cond) throw new Error(message);
}

export function assertEq(actual, expected, message = "") {
  if (actual !== expected) {
    throw new Error(`${message || "not equal"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertMatch(value, re, message = "") {
  if (!re.test(String(value))) {
    throw new Error(`${message || "no match"}: ${JSON.stringify(value)} !~ ${re}`);
  }
}

export async function assertRejects(fn, message = "expected a rejection") {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

export async function runAll({ name = "b2b-web-test" } = {}) {
  let pass = 0;
  const failures = [];
  for (const t of registered) {
    try {
      await t.fn();
      pass += 1;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failures.push({ name: t.name, err });
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${String(err?.message || err).split("\n")[0]}`);
    }
  }
  console.log("");
  console.log(`${name}: ${pass}/${registered.length} 通过`);
  if (failures.length) {
    console.log("");
    for (const f of failures) {
      console.log(`--- ${f.name} ---`);
      console.log(String(f.err?.stack || f.err));
    }
  }
  return failures.length === 0;
}

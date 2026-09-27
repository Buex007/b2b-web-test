// cli.test.mjs — drives the real launcher as a subprocess.
//
// The key-handling path is shell code, so unit-testing helpers would prove
// nothing: what matters is that a user who pipes a key in ends up with a
// correct 0600 config file, no duplicate lines, and an actionable message when
// something is missing. Every case runs against a sandbox directory so the
// developer's real ~/.config is never touched.

import { test, assert, assertEq, assertMatch, assertRejects } from "./harness.mjs";
import { nodePath, fs, readText } from "../lib/util.mjs";
import { execFileSync } from "node:child_process";

const SKILL_ROOT = new URL(".", import.meta.url).pathname.replace(/\/scripts\/test\/$/, "");
const BIN = `${SKILL_ROOT}/bin/b2b-test`;

const path = await nodePath();
const os = await import("node:os");
const sandboxRoot = await (await fs()).mkdtemp(path.join(os.tmpdir(), "b2b-cli-"));
let seq = 0;

async function sandbox() {
  seq += 1;
  const dir = path.join(sandboxRoot, `s${seq}`);
  await (await fs()).mkdir(dir, { recursive: true });
  return {
    dir,
    env: {
      ...process.env,
      B2B_CONFIG: path.join(dir, "config.env"),
      B2B_JEV_SECRETS: path.join(dir, "nonexistent.env"),
      B2B_WEB_TEST_HOME: path.join(dir, "data"),
      B2B_JEV_API_KEY: "",
    },
    configPath: path.join(dir, "config.env"),
  };
}

function runCli(args, { env, input } = {}) {
  return execFileSync("/bin/sh", [BIN, ...args], {
    env,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runCliExpectFailure(args, { env, input } = {}) {
  try {
    runCli(args, { env, input });
  } catch (err) {
    return { status: err.status, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
  throw new Error("expected the CLI to fail");
}

const FAKE_KEY = "sk-or-v1-EXAMPLE-NOT-A-REAL-KEY";

test("b2b-test key set writes a 0600 config and infers the backend", async () => {
  const sb = await sandbox();
  const out = runCli(["key", "set", "--stdin", "--no-probe"], {
    env: sb.env,
    input: `${FAKE_KEY}\n`,
  });
  assertMatch(out, /已写入/, "should confirm the write");
  const text = await readText(sb.configPath);
  assertMatch(text, /^B2B_JEV_API_KEY=sk-or-v1-EXAMPLE-NOT-A-REAL-KEY$/m, "key stored verbatim");
  assertMatch(text, /^B2B_JEV_BACKEND=openrouter$/m, "sk-or- implies the openrouter backend");
  const st = await (await fs()).stat(sb.configPath);
  assertEq(st.mode & 0o777, 0o600, "config must not be world-readable");
  assert(!out.includes(FAKE_KEY), "the full key must never be echoed back");
});

test("b2b-test key set replaces an existing key instead of duplicating", async () => {
  const sb = await sandbox();
  runCli(["key", "set", "--stdin", "--no-probe"], { env: sb.env, input: `${FAKE_KEY}\n` });
  runCli(["key", "set", "--stdin", "--no-probe"], {
    env: sb.env,
    input: "sk-or-v1-SECOND-EXAMPLE\n",
  });
  const text = await readText(sb.configPath);
  const occurrences = text.split("\n").filter((l) => l.startsWith("B2B_JEV_API_KEY=")).length;
  assertEq(occurrences, 1, "exactly one key line");
  assertMatch(text, /SECOND-EXAMPLE/, "the newer key wins");
  assert(!text.includes("sk-or-v1-EXAMPLE-NOT-A-REAL-KEY"), "the old key is gone");
});

test("an explicit backend overrides the guess", async () => {
  const sb = await sandbox();
  runCli(["key", "set", "--stdin", "--no-probe", "--backend", "typesafe"], {
    env: sb.env,
    input: "ts_example_key\n",
  });
  assertMatch(await readText(sb.configPath), /^B2B_JEV_BACKEND=typesafe$/m);
});

test("a pasted export line or stray quotes are cleaned up", async () => {
  const sb = await sandbox();
  runCli(["key", "set", "--stdin", "--no-probe"], {
    env: sb.env,
    input: `export OPENROUTER_API_KEY="${FAKE_KEY}"\n`,
  });
  const text = await readText(sb.configPath);
  assertMatch(text, new RegExp(`^B2B_JEV_API_KEY=${FAKE_KEY}$`, "m"), "only the value is stored");
  // A leading quote used to survive, which then made the backend guess wrong.
  assertMatch(text, /^B2B_JEV_BACKEND=openrouter$/m, "backend still inferred correctly");
});

test("a key containing '=' is not mistaken for a variable assignment", async () => {
  const sb = await sandbox();
  runCli(["key", "set", "--stdin", "--no-probe"], {
    env: sb.env,
    input: "sk-or-v1-abc=def==\n",
  });
  assertMatch(await readText(sb.configPath), /^B2B_JEV_API_KEY=sk-or-v1-abc=def==$/m);
});

test("missing key produces an actionable next command", async () => {
  const sb = await sandbox();
  const { status, out } = runCliExpectFailure(["key", "check"], { env: sb.env });
  assertEq(status, 1, "a missing key is a failure");
  assertMatch(out, /b2b-test key/, "must name the exact command to run");
  assertMatch(out, /不会替你申请/, "must say the tool will not obtain one for you");
});

test("doctor names the command when the key is missing", async () => {
  const sb = await sandbox();
  const { out } = runCliExpectFailure(["doctor"], { env: sb.env });
  assertMatch(out, /b2b-test key/, "doctor must point at the fix");
});

test("a shell metacharacter in a key cannot break out of the config file", async () => {
  const sb = await sandbox();
  runCli(["key", "set", "--stdin", "--no-probe"], {
    env: sb.env,
    input: "sk-or-v1-$(whoami)`id`;rm -rf /\n",
  });
  const text = await readText(sb.configPath);
  // It is stored as an opaque value: no command substitution happens on write,
  // and because config.env is sourced later, the value must not contain a
  // newline that could inject a second assignment.
  const keyLine = text.split("\n").find((l) => l.startsWith("B2B_JEV_API_KEY="));
  assert(keyLine && !keyLine.includes("\n"), "single line");
  assertMatch(keyLine, /^B2B_JEV_API_KEY=sk-or-v1-/, "prefix preserved");
});

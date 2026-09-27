// run.mjs — entry point for `b2b-test test` (and for direct runs).

import { runAll } from "./harness.mjs";

await import("./unit.test.mjs");
await import("./portability.test.mjs");
await import("./cli.test.mjs");
await import("./license.test.mjs");
await import("./docs.test.mjs");

const ok = await runAll({ name: "b2b-web-test 自测" });
if (!ok) process.exitCode = 1;

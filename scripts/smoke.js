// Smoke-test for the bundled extension. Stubs the `vscode` module
// (which is supplied by the editor at runtime and isn't installable
// from npm), loads `dist/extension.js`, and asserts the bundle exposes
// the activate/deactivate contract VS Code requires.
//
// This is what would have caught the "missing vscode-languageclient at
// runtime" regression: a successful `vsce package` is not the same as
// a loadable extension. Run as `npm run smoke`.

const Module = require("module");

// Just enough surface for vscode-languageclient + our activate path to
// load. We don't actually exercise it — loading is the test, since
// load-time failures are how a missing dep would surface in production.
// Anything we didn't enumerate falls through to a generic class stub so
// `class X extends vscode.CompletionItem` etc. don't throw.
const known = {
  commands: {
    registerCommand: () => ({ dispose: () => undefined }),
  },
  window: {
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    createOutputChannel: () => ({ show: () => undefined, dispose: () => undefined }),
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
  },
  env: {
    clipboard: { writeText: async () => undefined },
  },
};

const vscodeStub = new Proxy(known, {
  get(target, prop) {
    if (prop in target) return target[prop];
    // Default: a class so `class X extends vscode.Y` works.
    target[prop] = class StubVSCodeMember {};
    return target[prop];
  },
});

const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, ...rest);
};

const bundle = require("../dist/extension.js");

if (typeof bundle.activate !== "function") {
  console.error("Bundle smoke FAILED: activate() not exported");
  process.exit(1);
}
if (typeof bundle.deactivate !== "function") {
  console.error("Bundle smoke FAILED: deactivate() not exported");
  process.exit(1);
}
console.log("Bundle smoke OK: activate/deactivate exported, vscode-languageclient bundled");

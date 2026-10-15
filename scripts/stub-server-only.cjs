/* eslint-disable @typescript-eslint/no-require-imports -- CJS preload stub for node scripts */
// Lets one-off tsx scripts import modules that start with `import "server-only"`.
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "server-only" ? {} : load.call(this, request, ...rest);
};

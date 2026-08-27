// Redirects the two specifiers that reach outside the process — storage and
// the model provider — to in-memory stubs, so the real function code under
// test is loaded unmodified.
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BLOBS = resolvePath(here, "blobs-stub.mjs");
const GEMINI = resolvePath(here, "gemini-stub.mjs");

export async function resolve(specifier, context, next) {
  if (specifier.endsWith("_lib/blobs.js")) return next(BLOBS, context);
  if (specifier.endsWith("_lib/gemini.js")) return next(GEMINI, context);
  return next(specifier, context);
}

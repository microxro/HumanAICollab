// Redirects only the _lib/blobs.js specifier to the in-memory stub, so the
// real function code under test is loaded unmodified.
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const STUB = resolvePath(dirname(fileURLToPath(import.meta.url)), "blobs-stub.mjs");

export async function resolve(specifier, context, next) {
  if (specifier.endsWith("_lib/blobs.js")) return next(STUB, context);
  return next(specifier, context);
}

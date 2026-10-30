// Loader hook for the zero-native check. Any resolution of node-llama-cpp is reported on stderr.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "node-llama-cpp" || specifier.startsWith("node-llama-cpp/")) {
    process.stderr.write(`NATIVE_IMPORT:${specifier}\n`);
  }
  return nextResolve(specifier, context);
}

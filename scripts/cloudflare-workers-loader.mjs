const moduleUrl = "sites:cloudflare-workers";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: moduleUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === moduleUrl) {
    return {
      format: "module",
      source: "export const env = {};",
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}

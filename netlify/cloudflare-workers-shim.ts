// The Netlify build compiles the Cloudflare implementation for type safety,
// but runtime requests are dispatched to the Netlify storage adapters.
export const env: Record<string, never> = {};


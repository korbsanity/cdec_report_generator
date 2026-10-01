declare module "cloudflare:workers" {
  export type D1Database = unknown;
  export const env: { DB?: D1Database };
}

interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

type D1Database = object;

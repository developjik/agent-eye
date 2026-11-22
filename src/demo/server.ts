import { createServer } from "node:http";
import { DEMO_PAGES } from "./pages.js";

export interface DemoServer {
  url: string;
  close: () => Promise<void>;
}

/** Serve the built-in demo storefront on an ephemeral loopback port. */
export async function startDemoServer(): Promise<DemoServer> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const page = DEMO_PAGES[path];
    response.writeHead(page ? 200 : 404, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(page ?? DEMO_PAGES["/"]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

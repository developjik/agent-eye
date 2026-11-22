import { startDemoServer } from "../src/demo/server.js";
import type { RawElement } from "../src/types.js";

export async function withDemoServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = await startDemoServer();
  try {
    return await run(server.url);
  } finally {
    await server.close();
  }
}

const DEFAULTS: RawElement = {
  ref: "@e1",
  tag: "button",
  role: "button",
  name: "Continue",
  nameSource: "text",
  href: null,
  type: "button",
  disabled: false,
  ariaHidden: false,
  hidden: false,
  zeroSize: false,
  clipped: false,
  focusable: true,
  offscreen: false,
  occluded: false,
  occluder: null,
  inForm: false,
  shadow: false,
  box: { x: 10, y: 10, width: 100, height: 32 },
  text: "Continue",
};

export function element(partial: Partial<RawElement>): RawElement {
  return { ...DEFAULTS, ...partial };
}

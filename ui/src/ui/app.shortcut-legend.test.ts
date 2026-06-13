/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

async function createApp() {
  await import("./app.ts");
  return document.createElement("openclaw-app") as import("./app.ts").OpenClawApp & {
    globalKeydownHandler: (event: KeyboardEvent) => void;
  };
}

describe("OpenClawApp shortcut legend keyboard handling", () => {
  it("toggles the shortcut legend with ? outside text inputs and closes it with Escape", async () => {
    const app = await createApp();

    const openEvent = new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true });
    app.globalKeydownHandler(openEvent);

    expect(openEvent.defaultPrevented).toBe(true);
    expect(app.shortcutLegendOpen).toBe(true);

    const input = document.createElement("input");
    const ignoredEvent = new KeyboardEvent("keydown", {
      key: "?",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ignoredEvent, "target", { value: input });
    app.globalKeydownHandler(ignoredEvent);

    expect(ignoredEvent.defaultPrevented).toBe(false);
    expect(app.shortcutLegendOpen).toBe(true);

    const closeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    app.globalKeydownHandler(closeEvent);

    expect(app.shortcutLegendOpen).toBe(false);
  });
});

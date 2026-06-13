// Telegram tests cover that source-delivery records sent messages into the ledger.
import type { Bot } from "grammy";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadWebMedia } = vi.hoisted(() => ({ loadWebMedia: vi.fn() }));
const recordSentMessage = vi.hoisted(() => vi.fn());
const messageHookRunner = vi.hoisted(() => ({
  hasHooks: vi.fn<(name: string) => boolean>(() => false),
  runMessageSending: vi.fn(),
  runMessageSent: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/web-media", () => ({
  loadWebMedia: (...args: unknown[]) => loadWebMedia(...args),
}));

vi.mock("openclaw/plugin-sdk/plugin-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/plugin-runtime")>();
  return { ...actual, getGlobalHookRunner: () => messageHookRunner };
});

vi.mock("../sent-message-cache.js", () => ({
  recordSentMessage,
  wasSentByBot: vi.fn(() => false),
  clearSentMessageCache: vi.fn(),
}));

vi.mock("grammy", () => ({
  API_CONSTANTS: { DEFAULT_UPDATE_TYPES: ["message"], ALL_UPDATE_TYPES: ["message"] },
  InputFile: class {
    constructor(
      public buffer: Buffer,
      public fileName?: string,
    ) {}
  },
  GrammyError: class GrammyError extends Error {
    description = "";
  },
}));

vi.resetModules();
const { deliverReplies } = await import("./delivery.js");

type RuntimeStub = Pick<RuntimeEnv, "error" | "log" | "exit">;
function createRuntime(): RuntimeStub {
  return { error: vi.fn(), log: vi.fn(), exit: vi.fn() };
}
function createBot(api: Record<string, unknown>): Bot {
  return { api } as unknown as Bot;
}
const cfg = { session: { scope: "global" } } as unknown as OpenClawConfig;

describe("deliverReplies sent-message ledger", () => {
  beforeEach(() => {
    recordSentMessage.mockClear();
  });

  it("records the sent message id on successful text delivery", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 4242, chat: { id: "123" } });
    await deliverReplies({
      replies: [{ text: "hello" }],
      cfg,
      chatId: "123",
      token: "tok",
      runtime: createRuntime() as RuntimeEnv,
      bot: createBot({ sendMessage }),
      replyToMode: "off",
      textLimit: 4000,
      mediaLoader: loadWebMedia,
    });
    expect(recordSentMessage).toHaveBeenCalledWith("123", 4242, cfg);
  });

  it("does not record when nothing is delivered", async () => {
    await deliverReplies({
      replies: [{ text: "   " }],
      cfg,
      chatId: "123",
      token: "tok",
      runtime: createRuntime() as RuntimeEnv,
      bot: createBot({ sendMessage: vi.fn() }),
      replyToMode: "off",
      textLimit: 4000,
      mediaLoader: loadWebMedia,
    });
    expect(recordSentMessage).not.toHaveBeenCalled();
  });
});

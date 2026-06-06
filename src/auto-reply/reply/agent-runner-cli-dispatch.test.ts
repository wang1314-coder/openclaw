// Tests CLI dispatch arguments and runtime selection for agent runner turns.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddedAgentRunResult } from "../../agents/embedded-agent-runner/types.js";
import {
  keepCliSessionBindingOnlyWhenReused,
  runCliAgentWithLifecycle,
} from "./agent-runner-cli-dispatch.js";

const cliDispatchMocks = vi.hoisted(() => ({
  emitAgentEvent: vi.fn(),
  onAgentEvent: vi.fn(() => () => undefined),
  runCliAgent: vi.fn(),
}));

vi.mock("../../agents/cli-runner.js", () => ({
  runCliAgent: cliDispatchMocks.runCliAgent,
}));

vi.mock("../../infra/agent-events.js", () => ({
  emitAgentEvent: cliDispatchMocks.emitAgentEvent,
  onAgentEvent: cliDispatchMocks.onAgentEvent,
}));

beforeEach(() => {
  vi.clearAllMocks();
  cliDispatchMocks.onAgentEvent.mockReturnValue(() => undefined);
});

describe("runCliAgentWithLifecycle", () => {
  it("propagates yielded CLI result state on lifecycle end events", async () => {
    cliDispatchMocks.runCliAgent.mockResolvedValue({
      payloads: [],
      meta: {
        durationMs: 12,
        yielded: true,
        livenessState: "paused",
        stopReason: "end_turn",
      },
    } satisfies EmbeddedAgentRunResult);

    await runCliAgentWithLifecycle({
      runId: "run-yielded-cli",
      provider: "claude-cli",
      startedAt: 1_000,
      runParams: {
        sessionId: "session-yielded-cli",
        sessionFile: "/tmp/session-yielded-cli.jsonl",
        workspaceDir: "/tmp",
        prompt: "yield now",
        provider: "claude-cli",
        timeoutMs: 1_000,
        runId: "run-yielded-cli",
      },
    });

    const lifecycleEndEvent = cliDispatchMocks.emitAgentEvent.mock.calls
      .map(([event]) => event as { runId: string; stream: string; data: Record<string, unknown> })
      .find(
        (event) =>
          event.runId === "run-yielded-cli" &&
          event.stream === "lifecycle" &&
          event.data.phase === "end",
      );

    expect(lifecycleEndEvent?.data).toMatchObject({
      phase: "end",
      startedAt: 1_000,
      yielded: true,
      livenessState: "paused",
      stopReason: "end_turn",
    });
  });
});

describe("keepCliSessionBindingOnlyWhenReused", () => {
  it("keeps the first room-event CLI binding when no binding exists yet", () => {
    const result = {
      payloads: [],
      meta: {
        durationMs: 1,
        agentMeta: {
          sessionId: "new-cli-session",
          provider: "claude-cli",
          model: "claude-opus-4-8",
          cliSessionBinding: {
            sessionId: "new-cli-session",
            authProfileId: "profile",
          },
        },
      },
    } satisfies EmbeddedAgentRunResult;

    expect(keepCliSessionBindingOnlyWhenReused({ result })).toBe(result);
  });

  it("drops a replacement room-event CLI binding when an existing binding was reused", () => {
    const onDroppedReplacement = vi.fn();
    const result = keepCliSessionBindingOnlyWhenReused({
      existingSessionId: "existing-cli-session",
      onDroppedReplacement,
      result: {
        payloads: [],
        meta: {
          durationMs: 1,
          agentMeta: {
            sessionId: "replacement-cli-session",
            provider: "claude-cli",
            model: "claude-opus-4-8",
            cliSessionBinding: {
              sessionId: "replacement-cli-session",
              authProfileId: "profile",
            },
          },
        },
      } satisfies EmbeddedAgentRunResult,
    });

    expect(onDroppedReplacement).toHaveBeenCalledOnce();
    expect(result.meta.agentMeta?.sessionId).toBe("");
    expect(result.meta.agentMeta?.cliSessionBinding).toBeUndefined();
  });
});

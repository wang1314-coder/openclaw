import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeProviderAuthLookup } from "../model-auth.js";
import { hasProviderAuthForTool } from "./model-config.helpers.js";

function createRuntimeLookup(
  syntheticAuthProviderRefs: readonly string[] = [],
): RuntimeProviderAuthLookup {
  return {
    envApiKey: {
      aliasMap: {},
      candidateMap: {},
      authEvidenceMap: {},
    },
    syntheticAuthProviderRefs,
  };
}

const modelAuthMock = vi.hoisted(() => ({
  createRuntimeProviderAuthLookup: vi.fn(() => createRuntimeLookup()),
  hasRuntimeAvailableProviderAuth: vi.fn(() => false),
  resolveEnvApiKey: vi.fn(() => null),
}));

vi.mock("../model-auth.js", () => ({
  createRuntimeProviderAuthLookup: modelAuthMock.createRuntimeProviderAuthLookup,
  hasRuntimeAvailableProviderAuth: modelAuthMock.hasRuntimeAvailableProviderAuth,
  resolveEnvApiKey: modelAuthMock.resolveEnvApiKey,
}));

describe("hasProviderAuthForTool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    modelAuthMock.createRuntimeProviderAuthLookup.mockReturnValue(createRuntimeLookup());
    modelAuthMock.hasRuntimeAvailableProviderAuth.mockReturnValue(false);
    modelAuthMock.resolveEnvApiKey.mockReturnValue(null);
  });

  it("accepts config-backed custom provider auth", () => {
    const cfg = {
      models: {
        providers: {
          hatchery: {
            baseUrl: "https://example.com/v1",
            apiKey: "sk-configured", // pragma: allowlist secret
            models: [],
          },
        },
      },
    } as OpenClawConfig;
    modelAuthMock.hasRuntimeAvailableProviderAuth.mockReturnValue(true);

    expect(hasProviderAuthForTool({ provider: "hatchery", cfg })).toBe(true);
  });

  it("keeps auth-store profiles as valid tool auth", () => {
    expect(
      hasProviderAuthForTool({
        provider: "hatchery",
        authStore: {
          version: 1,
          profiles: {
            "hatchery:default": {
              provider: "hatchery",
              type: "api_key",
              key: "sk-profile", // pragma: allowlist secret
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects providers without config, env, or profile auth", () => {
    expect(hasProviderAuthForTool({ provider: "unconfigured-provider" })).toBe(false);
  });

  it("accepts scoped runtime provider auth", () => {
    const cfg = {} as OpenClawConfig;
    const runtimeLookup = createRuntimeLookup(["codex"]);
    modelAuthMock.createRuntimeProviderAuthLookup.mockReturnValue(runtimeLookup);
    modelAuthMock.hasRuntimeAvailableProviderAuth.mockReturnValue(true);

    expect(
      hasProviderAuthForTool({
        provider: "codex",
        cfg,
        workspaceDir: "/tmp/openclaw-workspace",
      }),
    ).toBe(true);
    expect(modelAuthMock.createRuntimeProviderAuthLookup).toHaveBeenCalledWith({
      cfg,
      workspaceDir: "/tmp/openclaw-workspace",
    });
    expect(modelAuthMock.hasRuntimeAvailableProviderAuth).toHaveBeenCalledWith({
      provider: "codex",
      cfg,
      workspaceDir: "/tmp/openclaw-workspace",
      runtimeLookup,
    });
  });
});

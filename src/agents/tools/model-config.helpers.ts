import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
  resolveAgentModelTimeoutMsValue,
} from "../../config/model-input.js";
import type { AgentToolModelConfig } from "../../config/types.agents-shared.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  externalCliDiscoveryForProviderAuth,
  ensureAuthProfileStore,
  ensureAuthProfileStoreWithoutExternalProfiles,
  hasAnyAuthProfileStoreSource,
  listProfilesForProvider,
} from "../auth-profiles.js";
import type { AuthProfileCredential, AuthProfileStore } from "../auth-profiles/types.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../defaults.js";
import {
  createRuntimeProviderAuthLookup,
  hasRuntimeAvailableProviderAuth,
  resolveEnvApiKey,
  type RuntimeProviderAuthLookup,
} from "../model-auth.js";
import { resolveConfiguredModelRef } from "../model-selection.js";
import { normalizeProviderId } from "../provider-id.js";

export type ToolModelConfig = { primary?: string; fallbacks?: string[]; timeoutMs?: number };

export function hasToolModelConfig(model: ToolModelConfig | undefined): boolean {
  return Boolean(
    model?.primary?.trim() || (model?.fallbacks ?? []).some((entry) => entry.trim().length > 0),
  );
}

export function resolveDefaultModelRef(cfg?: OpenClawConfig): { provider: string; model: string } {
  if (cfg) {
    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });
    return { provider: resolved.provider, model: resolved.model };
  }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

export function hasAuthForProvider(params: {
  provider: string;
  agentDir?: string;
  authStore?: AuthProfileStore;
}): boolean {
  if (resolveEnvApiKey(params.provider)?.apiKey) {
    return true;
  }
  return hasAuthProfileForProvider({ ...params, includeExternalCli: true });
}

export function hasAuthProfileForProvider(params: {
  provider: string;
  agentDir?: string;
  authStore?: AuthProfileStore;
  includeExternalCli?: boolean;
  type?: AuthProfileCredential["type"];
}): boolean {
  let store = params.authStore;
  if (!store) {
    const agentDir = params.agentDir?.trim();
    if (!agentDir) {
      return false;
    }
    if (!hasAnyAuthProfileStoreSource(agentDir)) {
      return false;
    }
    store = params.includeExternalCli
      ? ensureAuthProfileStore(agentDir, {
          externalCli: externalCliDiscoveryForProviderAuth({ provider: params.provider }),
        })
      : ensureAuthProfileStoreWithoutExternalProfiles(agentDir, {
          allowKeychainPrompt: false,
        });
  }
  const profileIds = listProfilesForProvider(store, params.provider);
  if (!params.type) {
    return profileIds.length > 0;
  }
  return profileIds.some((profileId) => store.profiles[profileId]?.type === params.type);
}

export function hasProviderAuthForTool(params: {
  provider: string;
  cfg?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  authStore?: AuthProfileStore;
  runtimeAuthLookup?: RuntimeProviderAuthLookup;
}): boolean {
  const provider = normalizeProviderId(params.provider);
  if (
    hasRuntimeAvailableProviderAuth({
      provider,
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      runtimeLookup:
        params.runtimeAuthLookup ??
        createRuntimeProviderAuthLookup({
          cfg: params.cfg,
          workspaceDir: params.workspaceDir,
        }),
    })
  ) {
    return true;
  }
  if (
    hasAuthForProvider({
      provider: params.provider,
      agentDir: params.agentDir,
      authStore: params.authStore,
    })
  ) {
    return true;
  }
  return false;
}

function isOpenAiGptModelRef(ref: { provider: string; model: string }): boolean {
  return (
    normalizeProviderId(ref.provider) === "openai" &&
    ref.model.trim().toLowerCase().startsWith("gpt-")
  );
}

function hasDirectOpenAiAuthForTool(params: {
  cfg?: OpenClawConfig;
  agentDir: string;
  workspaceDir?: string;
  authStore?: AuthProfileStore;
}): boolean {
  if (
    hasRuntimeAvailableProviderAuth({
      provider: "openai",
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      allowPluginSyntheticAuth: false,
      runtimeLookup: createRuntimeProviderAuthLookup({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        includePluginSyntheticAuth: false,
      }),
    })
  ) {
    return true;
  }
  return hasAuthProfileForProvider({
    provider: "openai",
    agentDir: params.agentDir,
    authStore: params.authStore,
  });
}

export function resolveCodexMediaCandidateForOpenAiCodexRoute(params: {
  cfg?: OpenClawConfig;
  primary: { provider: string; model: string };
  agentDir: string;
  workspaceDir?: string;
  authStore?: AuthProfileStore;
  resolveDefaultMediaModel: (params: {
    cfg?: OpenClawConfig;
    workspaceDir?: string;
    providerId: string;
    capability: "image";
  }) => string | undefined;
}): string | null {
  if (!isOpenAiGptModelRef(params.primary)) {
    return null;
  }
  if (hasDirectOpenAiAuthForTool(params)) {
    return null;
  }
  if (
    !hasAuthProfileForProvider({
      provider: "openai-codex",
      agentDir: params.agentDir,
      authStore: params.authStore,
    })
  ) {
    return null;
  }
  if (
    !hasProviderAuthForTool({
      provider: "codex",
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
      authStore: params.authStore,
    })
  ) {
    return null;
  }
  const modelId = params.resolveDefaultMediaModel({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    providerId: "codex",
    capability: "image",
  });
  return modelId ? `codex/${modelId}` : null;
}

export function coerceToolModelConfig(model?: AgentToolModelConfig): ToolModelConfig {
  const primary = resolveAgentModelPrimaryValue(model);
  const fallbacks = resolveAgentModelFallbackValues(model);
  const timeoutMs = resolveAgentModelTimeoutMsValue(model);
  return {
    ...(primary?.trim() ? { primary: primary.trim() } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export function buildToolModelConfigFromCandidates(params: {
  explicit: ToolModelConfig;
  cfg?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  authStore?: AuthProfileStore;
  candidates: Array<string | null | undefined>;
  isProviderConfigured?: (provider: string) => boolean;
}): ToolModelConfig | null {
  if (hasToolModelConfig(params.explicit)) {
    return params.explicit;
  }

  const runtimeAuthLookup = createRuntimeProviderAuthLookup({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
  });
  const deduped: string[] = [];
  for (const candidate of params.candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || !trimmed.includes("/")) {
      continue;
    }
    const provider = trimmed.slice(0, trimmed.indexOf("/")).trim();
    const providerConfigured =
      params.isProviderConfigured?.(provider) ??
      hasProviderAuthForTool({
        provider,
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        agentDir: params.agentDir,
        authStore: params.authStore,
        runtimeAuthLookup,
      });
    if (!provider || !providerConfigured) {
      continue;
    }
    if (!deduped.includes(trimmed)) {
      deduped.push(trimmed);
    }
  }

  if (deduped.length === 0) {
    return null;
  }

  return {
    primary: deduped[0],
    ...(deduped.length > 1 ? { fallbacks: deduped.slice(1) } : {}),
    ...(params.explicit.timeoutMs !== undefined ? { timeoutMs: params.explicit.timeoutMs } : {}),
  };
}

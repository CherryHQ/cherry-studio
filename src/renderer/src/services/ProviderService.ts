import { getStoreProviders } from "@renderer/hooks/useStore";
import type { Model, Provider } from "@renderer/types";
import {
  oauthWith302AI,
  oauthWithAihubmix,
  oauthWithAiOnly,
  oauthWithPoe,
  oauthWithPPIO,
  oauthWithSiliconFlow,
  oauthWithTokenFlux,
  ProviderOAuthResult,
} from "@renderer/utils/oauth";
import { getFancyProviderName } from "@renderer/utils";

export type ProviderOAuthAction =
  | "charge"
  | "bills"
  | "apiKey"
  | "officialWebsite";

type ProviderAuthHandler = (
  setKey?: (result: ProviderOAuthResult) => void,
) => Promise<unknown> | void;

type ProviderCapability = {
  authHandler?: ProviderAuthHandler;
  actions?: ProviderOAuthAction[];
};

const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  "302ai": {
    authHandler: oauthWith302AI,
    actions: ["charge", "bills"],
  },
  silicon: {
    authHandler: oauthWithSiliconFlow,
    actions: ["charge", "bills"],
  },
  aihubmix: {
    authHandler: oauthWithAihubmix,
    actions: ["charge", "bills"],
  },
  ppio: {
    authHandler: oauthWithPPIO,
    actions: ["charge", "bills"],
  },
  tokenflux: {
    authHandler: oauthWithTokenFlux,
    actions: ["charge", "bills"],
  },
  aionly: {
    authHandler: oauthWithAiOnly,
    actions: ["charge", "bills"],
  },
  poe: {
    authHandler: oauthWithPoe,
    actions: ["apiKey"],
  },
};

export function getProviderName(model?: Model) {
  const provider = getProviderByModel(model);

  if (!provider) {
    return "";
  }

  return getFancyProviderName(provider);
}

export function getProviderNameById(pid: string) {
  const provider = getStoreProviders().find((p) => p.id === pid);
  if (provider) {
    return getFancyProviderName(provider);
  } else {
    return "Unknown Provider";
  }
}

//FIXME: 和 AssistantService.ts 中的同名函数冲突
export function getProviderByModel(model?: Model) {
  const id = model?.provider;
  const provider = getStoreProviders().find((p) => p.id === id);

  if (provider?.id === "cherryai") {
    const map = {
      "Qwen/Qwen3-8B": "cherryin",
      "Qwen/Qwen3-Next-80B-A3B-Instruct": "cherryin",
    };

    const providerId = map[model?.id as keyof typeof map];

    if (providerId) {
      return getProviderById(providerId);
    }
  }

  return provider;
}

function getProviderCapability(provider: Provider) {
  return PROVIDER_CAPABILITIES[provider.id];
}

export function getProviderAuthHandler(provider: Provider) {
  return getProviderCapability(provider)?.authHandler;
}

export function getProviderOAuthActions(
  provider: Provider,
): ProviderOAuthAction[] {
  return getProviderCapability(provider)?.actions || [];
}

export function isProviderSupportAuth(provider: Provider) {
  return !!getProviderAuthHandler(provider);
}

export function isProviderSupportCharge(provider: Provider) {
  return getProviderOAuthActions(provider).includes("charge");
}

export function isProviderSupportBills(provider: Provider) {
  return getProviderOAuthActions(provider).includes("bills");
}

export function getProviderById(id: string) {
  return getStoreProviders().find((p) => p.id === id);
}

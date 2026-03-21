import { HStack } from "@renderer/components/Layout";
import OAuthButton from "@renderer/components/OAuth/OAuthButton";
import { getProviderLogo, PROVIDER_CONFIG } from "@renderer/config/providers";
import { useProvider } from "@renderer/hooks/useProvider";
import { getProviderLabel } from "@renderer/i18n/label";
import {
  getProviderAuthHandler,
  getProviderOAuthActions,
  ProviderOAuthAction,
} from "@renderer/services/ProviderService";
import {
  providerBills,
  providerCharge,
  ProviderOAuthResult,
} from "@renderer/utils/oauth";
import dayjs from "dayjs";
import { Alert, Button } from "antd";
import { isEmpty } from "lodash";
import {
  CheckCircle2,
  CircleDollarSign,
  KeyRound,
  ReceiptText,
  RotateCcw,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { FC } from "react";
import { Trans, useTranslation } from "react-i18next";
import styled from "styled-components";

interface Props {
  providerId: string;
}

const POE_EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;

const ProviderOAuth: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation();
  const { provider, updateProvider } = useProvider(providerId);
  const providerConfig = PROVIDER_CONFIG[provider.id];
  const providerActions = getProviderOAuthActions(provider);
  const authHandler = getProviderAuthHandler(provider);

  const setOAuthResult = ({ apiKey, apiKeyExpiresAt }: ProviderOAuthResult) => {
    updateProvider({
      apiKey: apiKey.trim(),
      apiKeyExpiresAt,
    });
  };

  const clearApiKey = () => {
    updateProvider({ apiKey: "", apiKeyExpiresAt: undefined });
  };

  const reconnect = async () => {
    if (!authHandler) {
      return;
    }

    let handled = false;

    const handleSuccess = (result: ProviderOAuthResult) => {
      if (result.apiKey.trim()) {
        handled = true;
        setOAuthResult(result);
        window.message.success({
          content: t("auth.get_key_success"),
          key: "auth-success",
        });
      }
    };

    try {
      const result = await authHandler(handleSuccess);
      if (
        !handled &&
        result &&
        typeof result === "object" &&
        "apiKey" in result
      ) {
        handleSuccess(result as ProviderOAuthResult);
      }
    } catch (error) {
      const content =
        error instanceof Error && error.message
          ? error.message
          : t("settings.provider.oauth.error");
      window.message.error({ content, key: "auth-error" });
    }
  };

  let providerWebsite =
    providerConfig?.api?.url.replace("https://", "").replace("api.", "") ||
    provider.name;
  if (provider.id === "ppio") {
    providerWebsite = "ppio.com";
  } else if (provider.id === "poe") {
    providerWebsite = "poe.com";
  }

  const openProviderPage = (url?: string) => {
    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const onProviderAction = (action: ProviderOAuthAction) => {
    switch (action) {
      case "charge":
        providerCharge(provider.id);
        return;
      case "bills":
        providerBills(provider.id);
        return;
      case "apiKey":
        openProviderPage(providerConfig?.websites?.apiKey);
        return;
      case "officialWebsite":
        openProviderPage(providerConfig?.websites?.official);
        return;
    }
  };

  const isPoe = provider.id === "poe";
  const expiresAt = provider.apiKeyExpiresAt;
  const hasExpiry = isPoe && typeof expiresAt === "number";
  const remainingMs = hasExpiry ? expiresAt - Date.now() : undefined;
  const isExpired = typeof remainingMs === "number" && remainingMs <= 0;
  const isExpiringSoon =
    typeof remainingMs === "number" &&
    remainingMs > 0 &&
    remainingMs <= POE_EXPIRING_SOON_MS;
  const showExpiryWarning =
    !isEmpty(provider.apiKey) && hasExpiry && (isExpired || isExpiringSoon);
  const expiresAtLabel = hasExpiry
    ? dayjs(expiresAt).format("YYYY-MM-DD HH:mm")
    : "";

  const renderProviderAction = (action: ProviderOAuthAction) => {
    if (action === "charge") {
      return (
        <Button
          key={action}
          shape="round"
          icon={<CircleDollarSign size={16} />}
          onClick={() => onProviderAction(action)}
        >
          {t("settings.provider.charge")}
        </Button>
      );
    }

    if (action === "bills") {
      return (
        <Button
          key={action}
          shape="round"
          icon={<ReceiptText size={16} />}
          onClick={() => onProviderAction(action)}
        >
          {t("settings.provider.bills")}
        </Button>
      );
    }

    if (action === "apiKey") {
      return (
        <Button
          key={action}
          shape="round"
          icon={<KeyRound size={16} />}
          onClick={() => onProviderAction(action)}
        >
          {t("settings.provider.oauth.open_api_keys")}
        </Button>
      );
    }

    if (action === "officialWebsite") {
      return (
        <Button
          key={action}
          shape="round"
          icon={<SquareArrowOutUpRight size={16} />}
          onClick={() => onProviderAction(action)}
        >
          {t("settings.provider.oauth.open_provider_website")}
        </Button>
      );
    }

    return null;
  };

  return (
    <Container>
      <ProviderLogo
        src={getProviderLogo(provider.id)}
        alt={getProviderLabel(provider.id)}
      />
      {isEmpty(provider.apiKey) ? (
        <OAuthButton provider={provider} onSuccess={setOAuthResult}>
          {t("settings.provider.oauth.button", {
            provider: getProviderLabel(provider.id),
          })}
        </OAuthButton>
      ) : (
        <AuthenticatedContent>
          <ConnectedState>
            <CheckCircle2 size={16} />
            <span>{t("settings.provider.oauth.connected")}</span>
          </ConnectedState>
          {showExpiryWarning && (
            <WarningAlert
              type={isExpired ? "error" : "warning"}
              showIcon
              message={
                isExpired
                  ? t("settings.provider.oauth.poe.expired.title")
                  : t("settings.provider.oauth.poe.expiring_soon.title")
              }
              description={
                isExpired
                  ? t("settings.provider.oauth.poe.expired.description", {
                      date: expiresAtLabel,
                    })
                  : t("settings.provider.oauth.poe.expiring_soon.description", {
                      date: expiresAtLabel,
                    })
              }
              action={
                <Button
                  size="small"
                  type={isExpired ? "primary" : "default"}
                  onClick={reconnect}
                >
                  {t("settings.provider.oauth.reconnect")}
                </Button>
              }
            />
          )}
          <ActionsRow gap={10} justifyContent="center">
            {providerActions.map(renderProviderAction)}
            <Button
              shape="round"
              icon={<RotateCcw size={16} />}
              onClick={isPoe ? reconnect : clearApiKey}
            >
              {t("settings.provider.oauth.reconnect")}
            </Button>
          </ActionsRow>
        </AuthenticatedContent>
      )}
      <Description>
        <Trans
          i18nKey="settings.provider.oauth.description"
          components={{
            website: (
              <OfficialWebsite
                href={providerConfig?.websites?.official}
                target="_blank"
                rel="noreferrer"
              />
            ),
          }}
          values={{ provider: providerWebsite }}
        />
      </Description>
    </Container>
  );
};

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 20px;
`;

const AuthenticatedContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
`;

const ConnectedState = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 500;
`;

const ProviderLogo = styled.img`
  width: 60px;
  height: 60px;
  border-radius: 50%;
`;

const Description = styled.div`
  font-size: 11px;
  color: var(--color-text-2);
  display: flex;
  align-items: center;
  gap: 5px;
`;

const OfficialWebsite = styled.a`
  text-decoration: none;
  color: var(--color-text-2);
`;

const WarningAlert = styled(Alert)`
  width: min(100%, 420px);
  text-align: left;
`;

const ActionsRow = styled(HStack)`
  flex-wrap: wrap;
`;

export default ProviderOAuth;

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchMembership } from "./membershipApi";
import { PointsDetails } from "./PointsDetails.jsx";

export default async () => {
  render(<Extension />, document.body);
};

function getStatusLabel(status) {
  if (status === "ACTIVE") {
    return shopify.i18n.translate("statusActive");
  }

  if (status === "INACTIVE") {
    return shopify.i18n.translate("statusInactive");
  }

  return shopify.i18n.translate("statusPending");
}

function getStatusTextTone(status) {
  if (status === "INACTIVE") {
    return "critical";
  }

  if (status === "PENDING") {
    return "warning";
  }

  return "success";
}

function renderStatusLabel(status) {
  return (
    <s-box padding="small" background="subdued" borderRadius="large">
      <s-text type="strong" tone={getStatusTextTone(status)}>
        {getStatusLabel(status)}
      </s-text>
    </s-box>
  );
}

function JoinMembershipPrompt() {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-heading>{shopify.i18n.translate("membershipTitle")}</s-heading>
        <s-banner tone="info">
          <s-stack direction="block" gap="small">
            <s-text>{shopify.i18n.translate("membershipNotJoinedTitle")}</s-text>
            <s-text color="subdued">
              {shopify.i18n.translate("membershipNotJoinedDescription")}
            </s-text>
          </s-stack>
        </s-banner>
        <s-button variant="primary">
          {shopify.i18n.translate("joinMembership")}
        </s-button>
      </s-stack>
    </s-box>
  );
}

function InactiveMembershipNotice() {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-heading>{shopify.i18n.translate("membershipTitle")}</s-heading>
        <s-banner tone="critical">
          <s-stack direction="block" gap="small">
            <s-text>{shopify.i18n.translate("membershipInactiveTitle")}</s-text>
            <s-text color="subdued">
              {shopify.i18n.translate("membershipInactiveDescription")}
            </s-text>
          </s-stack>
        </s-banner>
      </s-stack>
    </s-box>
  );
}

function Extension() {
  const [membership, setMembership] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadMembership() {
      try {
        const data = await fetchMembership();

        if (isMounted) {
          setMembership(data);
          setError(null);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError.message);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadMembership();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <s-box padding="base" border="base" borderRadius="base">
        <s-text>{shopify.i18n.translate("loadingMembership")}</s-text>
      </s-box>
    );
  }

  if (error) {
    return (
      <s-banner tone="warning">
        <s-text>
          {shopify.i18n.translate("membershipLoadError")} {error}
        </s-text>
      </s-banner>
    );
  }

  if (!membership) {
    return <JoinMembershipPrompt />;
  }

  if (membership.status === "INACTIVE") {
    return <InactiveMembershipNotice />;
  }

  if (membership.status !== "ACTIVE") {
    return <JoinMembershipPrompt />;
  }

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-heading>{shopify.i18n.translate("membershipTitle")}</s-heading>
        <s-stack direction="inline" gap="base">
          {renderStatusLabel(membership.status)}
          <s-text>{membership.levelName}</s-text>
        </s-stack>
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">
                {shopify.i18n.translate("pointsBalance")}
              </s-text>
              <s-heading>{membership.balance}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">
                {shopify.i18n.translate("lifetimeEarned")}
              </s-text>
              <s-heading>{membership.lifetimeEarned}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
        <s-stack direction="block" gap="small">
          <s-progress
            value={membership.levelProgressPercent}
            max={100}
            accessibilityLabel={shopify.i18n.translate("levelProgress")}
          ></s-progress>
          <s-text color="subdued">
            {membership.isHighestLevel
              ? shopify.i18n.translate("highestLevel")
              : shopify.i18n.translate("pointsToNextLevel", {
                  points: membership.pointsToNextLevel,
                  level: membership.nextLevelName,
                })}
          </s-text>
        </s-stack>
        <PointsDetails membership={membership} />
      </s-stack>
    </s-box>
  );
}

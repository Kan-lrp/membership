import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchMembership } from "./membershipApi";

export default async () => {
  render(<Extension />, document.body);
};

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
      <s-banner>
        <s-text>{shopify.i18n.translate("loadingMembership")}</s-text>
      </s-banner>
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
    return (
      <s-banner tone="info">
        <s-stack direction="block" gap="small">
          <s-text>{shopify.i18n.translate("membershipNotJoinedTitle")}</s-text>
          <s-text color="subdued">
            {shopify.i18n.translate("membershipNotJoinedDescription")}
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  if (membership.status === "INACTIVE") {
    return (
      <s-banner tone="critical">
        <s-stack direction="block" gap="small">
          <s-text>{shopify.i18n.translate("membershipInactiveTitle")}</s-text>
          <s-text color="subdued">
            {shopify.i18n.translate("membershipInactiveDescription")}
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  if (membership.status !== "ACTIVE") {
    return (
      <s-banner tone="info">
        <s-stack direction="block" gap="small">
          <s-text>{shopify.i18n.translate("membershipNotJoinedTitle")}</s-text>
          <s-text color="subdued">
            {shopify.i18n.translate("membershipNotJoinedDescription")}
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  return (
    <s-banner tone="success">
      <s-stack direction="block" gap="small">
        <s-text>
          {shopify.i18n.translate("membershipSummary", {
            points: membership.balance,
            level: membership.levelName,
          })}
        </s-text>
        {!membership.isHighestLevel && (
          <s-text color="subdued">
            {shopify.i18n.translate("pointsToNextLevel", {
              points: membership.pointsToNextLevel,
              level: membership.nextLevelName,
            })}
          </s-text>
        )}
      </s-stack>
    </s-banner>
  );
}
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchMembership } from "./membershipApi";
import { PointsDetails } from "./PointsDetails.jsx";

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
          setMembership(null);
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

  if (membership?.status !== "ACTIVE") {
    return (
      <s-box padding="base" border="base" borderRadius="base">
        <s-stack direction="block" gap="small">
          <s-text type="strong">
              {shopify.i18n.translate("currentPointsTitle")}
          </s-text>
          <s-text color="subdued">
            {shopify.i18n.translate("membershipNotJoinedDescription")}
          </s-text>
        </s-stack>
      </s-box>
    );
  }

  const earnedPoints = membership.lifetimeEarned ?? membership.balance ?? 0;

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" justifyContent="space-between">
          <s-stack direction="block" gap="small">
            <s-text type="strong">
              {shopify.i18n.translate("currentPointsTitle")}
            </s-text>
            <s-text color="subdued">
              {shopify.i18n.translate("earnedPointsDescription", {
                level: membership.levelName,
              })}
            </s-text>
          </s-stack>
          <s-text type="strong">
            {earnedPoints} {shopify.i18n.translate("pointsUnit")}
          </s-text>
        </s-stack>
        <PointsDetails membership={membership} />
      </s-stack>
    </s-box>
  );
}

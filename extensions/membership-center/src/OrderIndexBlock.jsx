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

  useEffect(() => {
    let isMounted = true;

    async function loadMembership() {
      try {
        const data = await fetchMembership();

        if (isMounted) {
          setMembership(data);
        }
      } catch {
        if (isMounted) {
          setMembership(null);
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

  if (isLoading || membership?.status !== "ACTIVE") {
    return null;
  }

  const earnedPoints = membership.lifetimeEarned ?? membership.balance ?? 0;

  return (
    <s-announcement>
      <s-stack direction="inline" gap="base" justifyContent="space-between">
        <s-stack direction="block" gap="small">
          <s-text type="strong">
            {shopify.i18n.translate("earnedPointsTitle")}
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
    </s-announcement>
  );
}

/* eslint-disable react/prop-types */

function formatSignedPoints(points) {
  return points > 0 ? `+${points}` : `${points}`;
}

function getPointsTone(points) {
  return points < 0 ? "critical" : "success";
}

function getPointStatusLabel(status) {
  if (status === "CREDITED") {
    return shopify.i18n.translate("orderPointsCredited");
  }

  if (status === "FAILED") {
    return shopify.i18n.translate("orderPointsFailed");
  }

  return shopify.i18n.translate("orderPointsNotCredited");
}

function getOrderPointsText(orderPoint) {
  const pointsText = `${formatSignedPoints(orderPoint.points)} ${shopify.i18n.translate(
    "pointsUnit",
  )}`;

  if (orderPoint.status === "CREDITED") {
    return pointsText;
  }

  return `${shopify.i18n.translate("estimatedPointsPrefix")} ${pointsText}`;
}

function getOrderLabel(orderPoint) {
  return orderPoint.orderName || shopify.i18n.translate("unknownOrder");
}

function getPointActivityLabel(activity) {
  return activity.label || activity.reason || shopify.i18n.translate("pointsActivity");
}

function getCustomerAccountOrderHref(orderId) {
  const numericOrderId = String(orderId ?? "").split("/").pop();

  if (!numericOrderId || numericOrderId === String(orderId ?? "")) {
    return null;
  }

  return `shopify:customer-account/orders/${numericOrderId}`;
}

function OrderReference({ orderPoint }) {
  const href = getCustomerAccountOrderHref(orderPoint.orderId);
  const label = getOrderLabel(orderPoint);

  if (!href) {
    return <s-text color="subdued">{label}</s-text>;
  }

  return (
    <s-link href={href} tone="auto">
      {label}
    </s-link>
  );
}

function PointActivityReference({ activity }) {
  const href = getCustomerAccountOrderHref(activity.orderId);
  const label = getPointActivityLabel(activity);

  if (!href) {
    return <s-text color="subdued">{label}</s-text>;
  }

  return (
    <s-link href={href} tone="auto">
      {label}
    </s-link>
  );
}

export function PointsDetails({ membership }) {
  const recentPointActivities = membership.recentPointActivities ?? [];
  const recentOrderPoints = membership.recentOrderPoints ?? [];

  if (recentPointActivities.length === 0 && recentOrderPoints.length === 0) {
    return null;
  }

  return (
    <s-details>
      <s-summary>{shopify.i18n.translate("pointsDetailsSummary")}</s-summary>
      <s-stack direction="block" gap="base">
        {recentPointActivities.length > 0 && (
          <s-stack direction="block" gap="small">
            <s-text type="strong">
              {shopify.i18n.translate("pointsSourceTitle")}
            </s-text>
            {recentPointActivities.map((activity) => (
              <s-stack
                key={activity.id}
                direction="inline"
                gap="base"
                justifyContent="space-between"
              >
                <PointActivityReference activity={activity} />
                <s-text type="strong" tone={getPointsTone(activity.points)}>
                  {formatSignedPoints(activity.points)}{" "}
                  {shopify.i18n.translate("pointsUnit")}
                </s-text>
              </s-stack>
            ))}
          </s-stack>
        )}

        {recentOrderPoints.length > 0 && (
          <s-stack direction="block" gap="small">
            <s-divider></s-divider>
            <s-text type="strong">
              {shopify.i18n.translate("recentOrderPointsTitle")}
            </s-text>
            <s-text color="subdued">
              {shopify.i18n.translate("orderPointsSupportMessage")}
            </s-text>
            {recentOrderPoints.map((orderPoint) => (
              <s-stack
                key={orderPoint.id}
                direction="inline"
                gap="base"
                justifyContent="space-between"
              >
                <OrderReference orderPoint={orderPoint} />
                <s-text type="strong" tone={getPointsTone(orderPoint.points)}>
                  {getOrderPointsText(orderPoint)} ·{" "}
                  {getPointStatusLabel(orderPoint.status)}
                </s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-details>
  );
}

/* global process */

const MEMBERSHIP_ENDPOINT = "/api/membership";
const DEFAULT_APP_URL = "https://judgment-clarity-hunt-text.trycloudflare.com";

function getAppUrl() {
  let appUrl = DEFAULT_APP_URL;

  try {
    appUrl =
      process.env.SHOPIFY_APP_URL ??
      process.env.VITE_SHOPIFY_APP_URL ??
      process.env.APP_URL ??
      DEFAULT_APP_URL;
  } catch {
    appUrl = DEFAULT_APP_URL;
  }

  return appUrl.replace(/\/$/, "");
}

export async function fetchMembership() {
  const appUrl = getAppUrl();

  const token = await shopify.sessionToken.get();
  const response = await fetch(`${appUrl}${MEMBERSHIP_ENDPOINT}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Unable to load membership data.");
  }

  return data.membership;
}

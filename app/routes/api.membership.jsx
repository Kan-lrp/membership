import { getCustomerMembershipData } from "../services/members.server";
import { verifyCustomerAccountSessionToken } from "../services/customer-account-session.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function jsonResponse(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    console.log("[membership-api] preflight", {
      origin: request.headers.get("Origin"),
    });

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const token = getBearerToken(request);

  console.log("[membership-api] request", {
    method: request.method,
    hasToken: Boolean(token),
    origin: request.headers.get("Origin"),
  });

  if (!token) {
    console.warn("[membership-api] missing token");

    return jsonResponse(
      { ok: false, error: "Missing customer account session token." },
      { status: 401 },
    );
  }

  try {
    const { shop, customerId } = verifyCustomerAccountSessionToken(token);
    const membership = await getCustomerMembershipData({ shop, customerId });

    console.log("[membership-api] loaded", {
      shop,
      customerId,
      hasMembership: Boolean(membership),
    });

    return jsonResponse({
      ok: true,
      membership,
    });
  } catch (error) {
    console.error("[membership-api] failed", error);

    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load membership data.",
      },
      { status: 401 },
    );
  }
};

export const action = async ({ request }) => {
  console.log("[membership-api] action", {
    method: request.method,
    origin: request.headers.get("Origin"),
  });

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  return jsonResponse(
    { ok: false, error: "Method not allowed." },
    { status: 405 },
  );
};

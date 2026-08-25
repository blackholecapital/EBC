const {
  conciergeGet,
} = require("../../../../shared/services/concierge");

module.exports = async ({ env }) => {
  let concierge;

  try {
    concierge = await conciergeGet(env, "/api/health");
  } catch (err) {
    console.error("CONCIERGE:", err);

    concierge = {
      ok: false,
      service: env.TENANT_ID === "ebc" ? "ebc-concierge-worker" : "blackhole-concierge-worker",
      health: "offline",
      error: String(err.message || err),
    };
  }

  return {
    ok: true,
    data: {
      concierge,
      dashboard: "online",
      runtime: "edge",
      version: env.APP_VERSION || "unknown",
      tenant: {
        tenantId:env.TENANT_ID || "blackhole",
        corporateId:env.CORPORATE_ID || env.TENANT_ID || "blackhole",
        defaultLocationId:env.DEFAULT_LOCATION_ID || "corporate",
      },
    },
  };
};

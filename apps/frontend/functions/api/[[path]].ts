export const onRequest: PagesFunction<{
  DASHBOARD: Fetcher;
  TENANT_ID: string;
  CORPORATE_ID: string;
  DEFAULT_LOCATION_ID: string;
}> = async (context) => {
  const url = new URL(context.request.url);

  const upstream = new URL(url.pathname + url.search, "https://dashboard.internal");
  const headers = new Headers(context.request.headers);
  headers.set("x-tenant-id", context.env.TENANT_ID || "ebc");
  headers.set("x-corporate-id", context.env.CORPORATE_ID || "ebc");
  if (!headers.has("x-location-id")) {
    headers.set("x-location-id", context.env.DEFAULT_LOCATION_ID || "corporate");
  }

  return context.env.DASHBOARD.fetch(
    new Request(upstream.toString(), {
      method: context.request.method,
      headers,
      body: ["GET", "HEAD"].includes(context.request.method) ? undefined : context.request.body,
      redirect: context.request.redirect,
    })
  );
};

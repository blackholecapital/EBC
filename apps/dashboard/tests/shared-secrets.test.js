const assert = require("assert");

(async () => {
  const { hydrateSharedSecrets } = await import("../../shared/cloudflare-secrets.mjs");

  let reads = 0;
  const shared = {
    CREDENTIAL_PROFILE:"xyz-demo",
    SHARED_RUNTIME_TOKEN:{ async get() { reads += 1; return "shared-token"; } },
  };
  const hydrated = await hydrateSharedSecrets(shared, [
    { target:"EILA_RUNTIME_TOKEN", binding:"SHARED_RUNTIME_TOKEN" },
    { target:"BUDDY_RUNTIME_TOKEN", binding:"SHARED_RUNTIME_TOKEN" },
  ]);
  assert.equal(hydrated.EILA_RUNTIME_TOKEN, "shared-token");
  assert.equal(hydrated.BUDDY_RUNTIME_TOKEN, "shared-token");
  assert.equal(reads, 1, "one binding should only be read once per request");

  const tenantOverride = await hydrateSharedSecrets({
    ...shared,
    EILA_RUNTIME_TOKEN:"tenant-token",
  }, [{ target:"EILA_RUNTIME_TOKEN", binding:"SHARED_RUNTIME_TOKEN" }]);
  assert.equal(tenantOverride.EILA_RUNTIME_TOKEN, "tenant-token");

  const disabled = await hydrateSharedSecrets({
    CREDENTIAL_PROFILE:"tenant",
    SHARED_RUNTIME_TOKEN:{ async get() { throw new Error("must not read"); } },
  }, [{ target:"EILA_RUNTIME_TOKEN", binding:"SHARED_RUNTIME_TOKEN" }]);
  assert.equal(disabled.EILA_RUNTIME_TOKEN, undefined);

  console.log("shared-secrets.test.js: all tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Resolve account-level Cloudflare Secrets Store bindings into the provider
 * variable names already used by the imported call-center code.
 *
 * A Worker secret set directly on the tenant always wins. This lets beta
 * tenants use the shared demo pool while paid tenants can override individual
 * providers without a code change.
 */
export async function hydrateSharedSecrets(rawEnv, mappings = []) {
  if (!rawEnv || String(rawEnv.CREDENTIAL_PROFILE || "").trim().toLowerCase() !== "xyz-demo") {
    return rawEnv;
  }

  const env = Object.create(rawEnv);
  const resolvedBindings = new Map();

  for (const { target, binding } of mappings) {
    if (!target || !binding || String(rawEnv[target] || "").trim()) continue;

    const secretBinding = rawEnv[binding];
    if (!secretBinding || typeof secretBinding.get !== "function") continue;

    try {
      let valuePromise = resolvedBindings.get(binding);
      if (!valuePromise) {
        valuePromise = secretBinding.get();
        resolvedBindings.set(binding, valuePromise);
      }
      const value = await valuePromise;
      if (value !== undefined && value !== null && String(value).trim()) env[target] = value;
    } catch (error) {
      console.error("Shared credential resolution failed", {
        binding,
        target,
        error:error?.message || String(error),
      });
    }
  }

  return env;
}

export function isEbcCallbackReply(value = "") {
  return /^ebc(?:\s+(?:call|call me|please))?\s*[.!]?$/i.test(String(value).trim());
}

function normalized(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstName(value = "") {
  const clean = String(value || "").trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : "";
}

function numberSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function meaningfulBargeIn({ transcript = "", confidence = 0, isFinal = false } = {}, env = {}) {
  const clean = normalized(transcript);
  if (!clean) return false;

  const immediate = /^(?:stop|wait|hold on|hang on|no|nope|yes|yeah|actually|excuse me|one second|just a second)$/i.test(clean);
  const filler = /^(?:uh+|um+|mm+|hmm+|ah+|oh+|huh|er+|background noise|music|laughter|laughing)$/i.test(clean);
  if (filler) return false;
  if (immediate) return true;

  const words = clean.split(" ").filter(Boolean);
  const minimumWords = Math.max(1, numberSetting(env.BARGE_IN_MIN_WORDS, 2));
  const minimumConfidence = numberSetting(
    isFinal ? env.BARGE_IN_FINAL_MIN_CONFIDENCE : env.BARGE_IN_INTERIM_MIN_CONFIDENCE,
    isFinal ? 0.78 : 0.88,
  );
  return words.length >= minimumWords && Number(confidence || 0) >= minimumConfidence;
}

export function conversationOpening(state = {}, { assistant = "EBC AI", brand = "Everything Built Custom" } = {}) {
  const name = firstName(state.firstName);
  const hello = name ? `Hi ${name}, it's ${assistant} from ${brand}.` : `Hi, it's ${assistant} from ${brand}.`;
  const subject = String(state.priorSelectedProduct || state.interest || "your cart project").trim();
  const estimate = String(state.estimateNumber || "").trim();
  const customerInitiated = /^(?:inbound|sms-reply|email-call-link|customer-callback)$/i.test(String(state.triggerType || ""));

  if (state.isFollowup) {
    const returnLine = customerInitiated ? "Thanks for getting back in touch." : "I'm following up on our earlier conversation.";
    const estimateLine = estimate
      ? `I have our notes and estimate ${estimate} for ${subject} right here, so you won't need to repeat yourself.`
      : `I have our notes about ${subject} right here, so you won't need to repeat yourself.`;
    return `${hello} ${returnLine} ${estimateLine} I can email an estimate, request a phone consultation, or arrange a time to bring the cart in for an evaluation. Which would help most?`;
  }

  if (customerInitiated) {
    return `${hello} Thanks for calling. I can help with an estimate, a phone consultation, or an appointment to bring the cart in. What are you working on?`;
  }

  const leadContext = [subject && subject !== "your cart project" ? subject : "", state.location]
    .filter(Boolean)
    .join(" in ");
  const contextLine = leadContext ? `I'm calling about your request for ${leadContext}.` : "I'm calling about your custom-cart request.";
  return `${hello} ${contextLine} I can help with an estimate, a phone consultation, or an appointment to bring the cart in. Which direction would you like to take?`;
}

export const BUDDY_DEMO_CATALOG = {
  "Power & Fuse Blocks": [
    { id:"g1-power-block", name:"G1 Power Block", short:"plug-and-play accessory power for Denago Nomad and Rover carts", basePrice:139.99 },
    { id:"g2-power-block", name:"G2 Power Block", short:"expanded plug-and-play power control for Denago Nomad and Rover carts", basePrice:239.99 },
  ],
  "Plug-and-Play Wire Kits": [
    { id:"speaker-adapter", name:"Plug-N-Play Speaker Adapter", short:"add speakers without cutting or splicing factory wiring", basePrice:79.99 },
    { id:"custom-wire-kit", name:"Custom Wiring Kit", short:"a make-and-model-specific harness reviewed by the EBC team", basePrice:null, needsReview:true },
  ],
  "Fan Kits": [
    { id:"nomad-front-fan", name:"Front Fan Kit — Nomad", short:"high-power front fan system with optional speaker and LED upgrades", basePrice:399.99 },
    { id:"rover-front-rear-fan", name:"Front & Rear Fan Kit — Rover", short:"dual fan setup with optional DS18 speakers and LED lighting", basePrice:539.99 },
  ],
  "Speaker & LED Upgrades": [
    { id:"open-speaker-pods", name:"Open-Back Speaker Pods", short:"mountable 6.5-inch pods with optional DS18 speakers and LED rings", basePrice:99.99 },
    { id:"custom-ds18-build", name:"Custom DS18 Build", short:"a complete custom Denago audio build", basePrice:1599.99 },
  ],
  "Programming & Remote Assist": [
    { id:"program-cable", name:"Programming Cable", short:"Windows-compatible Denago tuning cable with instructions", basePrice:69.99 },
    { id:"program-remote", name:"Programming Cable with Remote Assist", short:"compatible cable plus guided remote tuning support", basePrice:199.99 },
  ],
  "Custom Roofs & Enclosures": [
    { id:"slim-roof-rover", name:"Slim Roof — Rover XL", short:"low-profile roof that lowers overall height without modifying the cage", basePrice:449.99 },
    { id:"custom-roof-enclosure", name:"Custom Roof or Enclosure", short:"an EBC-designed roof, speaker enclosure, or one-off fabricated solution", basePrice:null, needsReview:true },
  ],
  "Compatibility & Technical Support": [
    { id:"fitment-review", name:"Compatibility & Fitment Review", short:"confirm make, model, year, connector, and accessory compatibility before purchase", basePrice:null, needsReview:true },
    { id:"remote-support", name:"Remote Technical Assist", short:"guided help with a compatible EBC product or programming setup", basePrice:null, needsReview:true },
  ],
  "Universal Accessories": [
    { id:"license-led", name:"License Plate Holder with LED Tag Light", short:"universal mount with integrated plate lighting", basePrice:89.99 },
    { id:"universal-custom", name:"Universal Custom Accessory", short:"a universal power, audio, lighting, or mounting solution", basePrice:null, needsReview:true },
  ],
  "Custom Project": [
    { id:"custom-project", name:"Custom Project Consultation", short:"a one-off fuse block, wiring kit, speaker enclosure, roof, or fabricated accessory", basePrice:null, needsReview:true },
  ],
};

const BASELINE_PRODUCTS = Object.values(BUDDY_DEMO_CATALOG).flat();

function normalize(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasKnownFitmentConflict(option, allText) {
  const text=normalize(allText);
  const denagoSpecific=/\b(?:denago|nomad|rover)\b/.test(normalize(`${option?.name||""} ${option?.short||""}`));
  const otherCart=/\b(?:e z go|ezgo|can am|evolution|honda|polaris)\b/.test(text);
  return denagoSpecific&&otherCart&&!/\bdenago\b/.test(text);
}

function bestCatalogOption(interest, selectedProduct, allText, allowCategoryFallback = false) {
  const options=BUDDY_DEMO_CATALOG[String(interest||"").trim()]||[];
  const selected=normalize(selectedProduct);
  if(selected){
    const exact=options.find(option=>normalize(option.name)===selected)||BASELINE_PRODUCTS.find(option=>normalize(option.name)===selected);
    if(exact)return hasKnownFitmentConflict(exact,allText)?null:exact;
  }
  const words=normalize(allText).split(/\s+/).filter(word=>word.length>=4);
  const mentioned=options.find(option=>!hasKnownFitmentConflict(option,allText)&&normalize(option.name).split(/\s+/).filter(word=>word.length>=4&&!['custom','project'].includes(word)).some(word=>words.includes(word)));
  if(mentioned)return mentioned;
  if(!allowCategoryFallback)return null;
  return options.find(option=>!option.needsReview&&Number.isFinite(Number(option.basePrice))&&!hasKnownFitmentConflict(option,allText))||null;
}

function buildProjectEstimate(option, location, allText) {
  if(!option||option.needsReview||!Number.isFinite(Number(option.basePrice)))return null;
  const total=Number(option.basePrice);
  const cartMatch=String(allText).match(/\b(?:denago|can-am|evolution|e-z-go|ezgo|honda|polaris)\b[^,.]*/i);
  return {
    id:`ebc-${option.id}`,
    subject:`Everything Built Custom ${option.name} Estimate`,
    facilityCode:"EBC",
    facilityName:String(location||"Shipping / installation location pending"),
    serviceName:option.name,
    monthlyTotal:total,
    currency:"USD",
    creditCardFeePercent:3.5,
    termMonths:0,
    validityDays:30,
    demoSample:true,
    setupFeeStandard:0,
    setupFeeDue:0,
    promotion:"Final price depends on selected options, compatibility, shipping, tax, and installation requirements",
    lineItems:[{ quantity:1, description:`${option.name} — ${option.short}${cartMatch?` · ${cartMatch[0]}`:""}`, unitPrice:total, total }],
  };
}

export const EBC_PRELIMINARY_ESTIMATES = Object.fromEntries(
  BASELINE_PRODUCTS.filter(option=>!option.needsReview&&option.basePrice!=null&&Number.isFinite(Number(option.basePrice))).map(option=>[option.id,buildProjectEstimate(option,"",option.name)]),
);

export function getEbcPreliminaryEstimate({ interest = "", location = "", conversation = "", selectedProduct = "", allowCategoryFallback = false } = {}) {
  const allText=`${interest} ${selectedProduct} ${location} ${conversation}`;
  return buildProjectEstimate(bestCatalogOption(interest,selectedProduct,allText,allowCategoryFallback),location,allText);
}

export function getBuddyDemoOptions(interest = "") {
  return BUDDY_DEMO_CATALOG[String(interest || "").trim()] || [];
}

export function formatBuddyDemoOptions(interest = "") {
  const options=getBuddyDemoOptions(interest);
  if(!options.length)return "";
  return options.map((option,index)=>`Option ${index===0?"one":"two"}: ${option.name}. ${option.short}.`).join("\n");
}

function normalizeSpeech(value = "") {
  return String(value || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9+' -]/g, " ").replace(/\s+/g, " ").trim();
}

function hasSelectionIntent(text) {
  return /\b(i'?ll take|i want|i choose|i pick|give me|go with|take|choose|pick|select|want|number|option)\b/.test(text);
}

export function parseBuddyChoice(transcript = "") {
  const normalized=normalizeSpeech(transcript);
  if(!normalized)return -1;
  if(/\b(?:option|number)\s*(?:1|one)\b/.test(normalized))return 0;
  if(/\b(?:option|number)\s*(?:2|two)\b/.test(normalized))return 1;
  if(/^(?:1|one)(?: please)?$/.test(normalized))return 0;
  if(/^(?:2|two)(?: please)?$/.test(normalized))return 1;
  if(hasSelectionIntent(normalized)){
    for(const options of Object.values(BUDDY_DEMO_CATALOG)){
      for(let index=0;index<options.length;index+=1){
        const significant=normalizeSpeech(options[index].name).split(" ").filter(word=>word.length>=3&&!['kit','custom','project','with'].includes(word));
        if(significant.some(word=>normalized.includes(word)))return index;
      }
    }
  }
  return -1;
}

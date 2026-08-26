(() => {
  "use strict";

  const ACTION_PATHS = new Set(["/ProcessInput.php", "/ProcessInputAPI.php"]);
  const TOKEN_PATTERN = /^[\p{L}\p{N}_.:+\-/]+$/u;
  const ZONE_PATTERN = /^(?:(MY|THEIR))?(HAND|ARS|ARSENAL|BANISH|CHAR|DISCARD|ITEMS|LAYER|PERM|PITCH|CC|BUTTON|MODAL)-(.+)$/i;
  const MAX_IDENTIFIERS = 100;

  function isTalisharHost(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return normalized === "talishar.net" || normalized.endsWith(".talishar.net");
  }

  function actionUrl(value, baseUrl) {
    try {
      const url = new URL(String(value), baseUrl);
      if (url.protocol !== "https:" || !isTalisharHost(url.hostname)) return null;
      const path = [...ACTION_PATHS].find((suffix) => url.pathname.endsWith(suffix));
      return path ? url : null;
    } catch {
      return null;
    }
  }

  function token(value, maxLength = 256) {
    if (!["string", "number", "boolean"].includes(typeof value)) return undefined;
    const normalized = String(value).trim();
    return normalized && normalized.length <= maxLength && TOKEN_PATTERN.test(normalized)
      ? normalized
      : undefined;
  }

  function splitIdentifier(value) {
    const normalized = token(value);
    if (!normalized) return {};
    const match = normalized.match(ZONE_PATTERN);
    if (!match) return { identifier: normalized };
    return {
      zone: `${match[1] || ""}${match[2]}`.toUpperCase(),
      identifier: match[3],
    };
  }

  function safeSubmissionIdentifiers(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const identifiers = [];
    for (const [key, item] of Object.entries(value)) {
      if (!/^(?:cardListTop|cardListBottom|layers|orderedLayers|triggerOrder|selectedCards)$/i.test(key)) continue;
      const values = Array.isArray(item) ? item : [item];
      for (const candidate of values) {
        const identifier = token(candidate);
        if (identifier) identifiers.push(identifier);
        if (identifiers.length >= MAX_IDENTIFIERS) return identifiers;
      }
    }
    return identifiers;
  }

  function choiceFromObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const action = token(value.mode, 40);
    if (!action) return null;

    const primaryInput = value.cardID ?? value.buttonInput;
    const primary = splitIdentifier(primaryInput);
    const identifiers = [];
    for (const [key, item] of Object.entries(value)) {
      if (!/^chk\d+$/i.test(key)) continue;
      const identifier = splitIdentifier(item).identifier;
      if (identifier) identifiers.push(identifier);
    }
    identifiers.push(...safeSubmissionIdentifiers(value.submission));

    const result = { action };
    if (primary.zone) result.zone = primary.zone;
    if (primary.identifier) result.identifier = primary.identifier;
    const uniqueIdentifiers = [...new Set(identifiers)].slice(0, MAX_IDENTIFIERS);
    if (uniqueIdentifiers.length) result.identifiers = uniqueIdentifiers;
    return result;
  }

  function objectFromSearchParams(params) {
    const value = {};
    for (const [key, item] of params) {
      if (/^(?:mode|cardID|buttonInput|chk\d+)$/i.test(key)) value[key] = item;
    }
    return value;
  }

  function objectFromBody(body) {
    if (body instanceof URLSearchParams) return objectFromSearchParams(body);
    if (typeof body !== "string" || body.length > 64 * 1024) return null;
    const trimmed = body.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return {
        mode: parsed.mode,
        cardID: parsed.cardID,
        buttonInput: parsed.buttonInput,
        submission: parsed.submission,
      };
    } catch {
      try {
        return objectFromSearchParams(new URLSearchParams(trimmed));
      } catch {
        return null;
      }
    }
  }

  async function decisionFromRequest(input, init, baseUrl) {
    const requestUrl = typeof input === "string" || input instanceof URL
      ? input
      : input?.url;
    const url = actionUrl(requestUrl, baseUrl);
    if (!url) return null;

    const queryChoice = choiceFromObject(objectFromSearchParams(url.searchParams));
    if (queryChoice) return queryChoice;

    let body = init?.body;
    if (typeof body !== "string" && input && typeof input.clone === "function") {
      try {
        body = await input.clone().text();
      } catch {
        body = null;
      }
    }
    return choiceFromObject(objectFromBody(body));
  }

  globalThis.__hyperdriverDecisionCapture = Object.freeze({
    actionUrl,
    choiceFromObject,
    decisionFromRequest,
  });
})();

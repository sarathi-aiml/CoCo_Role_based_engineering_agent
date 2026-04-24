const APPROVAL_RE = /\b(approv|approval|sign[\s-]?off|greenlight|authoriz)\b/i;

/**
 * Detect whether input is addressed to the other agent.
 *
 * Rule: if the other agent's name appears in the message → it's a send.
 * The AI then rephrases it into a natural message before delivery,
 * so we don't need to extract a "payload" here — just confirm routing.
 */
export function detectIntent(input, myName, otherName) {
  const other = otherName.toLowerCase();
  const t     = input.trim();

  if (!new RegExp(`\\b${other}\\b`, "i").test(t)) return { isSend: false };

  return {
    isSend:     true,
    target:     other,
    payload:    t,
    isApproval: APPROVAL_RE.test(t),
  };
}

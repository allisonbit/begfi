/**
 * The message rules, client-side mirrors of lib/messages.ts.
 *
 * Kept in their own file rather than imported from the server module for the
 * same reason the other form rules are duplicated: instant feedback in the
 * browser, with the server's word still final on submit.
 */

export const MESSAGE_MAX = 140;

const BANNED_PATTERNS = [
  /\bf[u*]ck(in[g]?)?\b/i,
  /\bsh[i*]t\b/i,
  /\bb[i1*]tch\b/i,
  /\bcu?nt\b/i,
  /\bn[i1*]gg/i,
  /\bf[a4*]g\b/i,
  /\br[a4*]pe\b/i,
  /\bdick\b/i,
  /\bc[o0]ck\b/i,
  /\bwh[o0]re\b/i,
  /\bscam\b/i,
  /^https?:\/\/(?!begfi\.io)/i,
  /^(send|trade|join|buy)\s+(me|my|@)?\s*(more|more $BEGFI|crypto|token)/i,
];

/** Null when the text is submittable; the reason when it is not. */
export function messageProblemClient(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null; // empty is fine: the field is optional
  if (trimmed.length > MESSAGE_MAX) return "140 characters maximum.";
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(trimmed)) return "That message breaks the house rules.";
  }
  return null;
}

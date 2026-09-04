/**
 * A stable name for one tool call, so repeating the call is not a second act.
 *
 * An agent retries: a response goes missing, a model repeats itself, a run is
 * resumed. Without this, `add_comment` called twice left two comments and the
 * reviewer had to tidy up after the agent — the opposite of the point.
 *
 * The name is derived from the call's own arguments rather than issued by the
 * caller, because an agent has no way to know it is repeating itself. Same
 * arguments, same name, and the server hands back the comment it already made.
 *
 * Only the tool layers do this. The web app sends nothing: a person who types
 * the same sentence twice means it, and collapsing that would be a bug.
 */
export async function callFingerprint(parts: readonly string[]): Promise<string> {
  /*
   * Each part is prefixed with its own length, so no arrangement of arguments
   * can be made to read as another arrangement — `['ab', 'c']` and `['a', 'bc']`
   * hash differently, which a plain separator could not guarantee for text a
   * reviewer is free to type.
   */
  const material = parts.map((part) => `${part.length}:${part}`).join('|');

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    /*
     * No WebCrypto means no secure context. Returning nothing is the safe
     * answer: the comment is still posted, just without the retry guard, which
     * is exactly the behaviour before this existed. A weak hash here would be a
     * collision risk dressed up as a feature.
     */
    return '';
  }

  const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(material)));
  // 128 bits is far more than enough to separate the calls one review receives.
  return Array.from(bytes.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The share URL the drawings show.
 *
 * Taken from wherever the app is actually running. The design mock wrote
 * `liha.dev/p/8fa2c1`, and shipping that literally meant a deployment on
 * livepreview.liha.dev advertised a domain that was not its own — the one
 * thing the illustration exists to teach.
 *
 * The slug stays short and invented. The picture is teaching "this link never
 * changes", not what a slug looks like, and a real 12-character one overflows
 * the little browser window it sits in.
 */
export function sampleShareUrl(): string {
  const host = typeof window === 'undefined' ? 'example.com' : window.location.host;
  return `${host}/p/8fa2c1`;
}

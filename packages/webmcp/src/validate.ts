/**
 * Checks a tool call's arguments against the schema the tool published.
 *
 * Chrome does not do this. `document.modelContext.executeTool(tool, json)`
 * parses the JSON and hands it straight to the tool, whatever `inputSchema`
 * said — verified against Chrome 151 on a live deployment, where
 * `set_viewport` with no arguments at all returned success and changed
 * nothing.
 *
 * Silently succeeding is the worst answer available. An agent told that the
 * preview is now 390px wide will go on to describe what it sees at mobile
 * width, having never left desktop. A refusal that names the problem lets it
 * correct the call and try again.
 *
 * This is a deliberately small subset of JSON Schema — the part these tools
 * actually use.
 */
export function validateArguments(
  name: string,
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
): string | null {
  if (!schema) return null;

  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];
  // Every problem, not just the first: an agent that has to discover them one
  // call at a time will burn its retries.
  const problems: string[] = [];

  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      problems.push(`missing required argument "${key}"`);
    }
  }

  if (schema.additionalProperties === false) {
    const known = Object.keys(properties);
    for (const key of Object.keys(args)) {
      if (!(key in properties)) {
        problems.push(
          `"${key}" is not an argument of this tool` +
            (known.length ? ` (it takes: ${known.join(', ')})` : ' (it takes no arguments)'),
        );
      }
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key];
    if (!spec || value === undefined) continue;

    const expected = spec.type as string | undefined;
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (expected === 'integer') {
      if (!Number.isInteger(value)) problems.push(`"${key}" must be an integer, got ${actual}`);
    } else if (expected && expected !== actual) {
      problems.push(`"${key}" must be ${expected}, got ${actual}`);
    } else if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      problems.push(`"${key}" must be one of ${spec.enum.join(', ')}`);
    }
  }

  return problems.length ? `${name}: ${problems.join('; ')}.` : null;
}

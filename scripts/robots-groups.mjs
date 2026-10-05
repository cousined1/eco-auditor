/**
 * RFC 9309 robots.txt group parser, shared by the SEO-04 unit test and the
 * runtime smoke gate.
 *
 * Why this is a module rather than a helper inlined in either caller: the whole
 * point of the 2026-10-05 audit was that two different *readers* of robots.txt
 * disagreed about what the file said. The unit test parsed groups properly; the
 * first version of the smoke gate did `text.split(/User-agent:/i)[1]`, which
 * reads a fragment of the file's own opening comment — the comment discusses
 * group semantics and literally contains the string `User-agent:` — and so
 * reported five failures against a file that was already correct. Two parsers,
 * one of them wrong, is exactly how SEO-04 ships.
 *
 * A group ends at the next `User-agent:` line that is not itself a continuation
 * of the current group's agent list. `Sitemap:` is a non-group directive.
 * Comments run to end of line; this file has a comment block that opens the
 * document, so comment stripping is not optional.
 */

/** @typedef {{agents: string[], allows: string[], disallows: string[]}} RobotsGroup */

/**
 * Parse a robots.txt body into its groups and sitemap directives.
 *
 * @param {string} text
 * @returns {{groups: RobotsGroup[], sitemaps: string[]}}
 */
export function parseRobots(text) {
  /** @type {RobotsGroup[]} */
  const groups = [];
  /** @type {string[]} */
  const sitemaps = [];
  /** @type {RobotsGroup|null} */
  let current = null;
  // RFC 9309: consecutive `User-agent:` lines list more agents for the SAME
  // group. The group only closes once a non-agent directive appears or a
  // `User-agent:` follows a directive.
  let expectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (current && !expectingAgents) current = null;
      if (!current) {
        current = { agents: [], allows: [], disallows: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      expectingAgents = true;
      continue;
    }
    if (field === 'allow' || field === 'disallow') {
      if (current) {
        if (field === 'allow') current.allows.push(value);
        else current.disallows.push(value);
      }
      expectingAgents = false;
    }
  }
  return { groups, sitemaps };
}

/**
 * The group a crawler applies for the named agent, or null if the file names no
 * such agent. Pass '*' for the wildcard group that Googlebot matches.
 *
 * @param {string} text
 * @param {string} agent
 * @returns {RobotsGroup|null}
 */
export function robotsGroup(text, agent) {
  const { groups } = parseRobots(text);
  return groups.find((g) => g.agents.includes(agent.toLowerCase())) || null;
}

/**
 * True when `agent` is forbidden from `path` — i.e. the agent has a group and
 * that group disallows the path. Used by the gate so a missing group and a
 * present-but-permissive group fail for the same reason.
 *
 * @param {string} text
 * @param {string} agent
 * @param {string} target
 */
export function isDisallowed(text, agent, target) {
  const group = robotsGroup(text, agent);
  return Boolean(group) && group.disallows.includes(target);
}
// F-X1-03 structural guard: authenticated calls to server.cjs go through
// apiFetch (src/lib/api.ts), which refreshes an expired access token instead
// of letting the 401 end the session. Any other way of sending the session
// token would quietly bring back the sign-out once per token lifetime.
// There is deliberately no allowlist: fix the call site instead.
//
// The first version of this guard was five regular expressions over the raw
// text, and five ordinary variations walked past it (D-5): the SDK headers read
// through a variable or a shorthand property (the exact shape stripe.ts used), a
// header name built from pieces, XMLHttpRequest.setRequestHeader with a
// constant, and anything at all inside api.ts, which was excluded wholesale.
// So the rules now work on tokens, not text, and they close the cause rather
// than chasing shapes:
//   1. Outside api.ts nothing may REACH the token: the SDK's HTTP client and
//      headers, its session getters and its refresh are off limits. The rest of
//      the app asks hasSession(), which answers true or false and never hands
//      the token out. Whatever header name a developer builds, there is no token
//      to put in it.
//   2. Outside api.ts nothing may SPELL the header: the name Authorization (as
//      an identifier, a quoted name, or a name assembled from literals, template
//      parts, concatenation, concat() or join()), a hand-built "Bearer ...", an
//      XMLHttpRequest or its setRequestHeader.
//   3. Inside api.ts the token has exactly one reader (authorizationFrom) and
//      one writer (withAuthorization), and only apiFetch sends with it, so a
//      second wrapper added there is caught too.
// This is a tripwire, not a proof: a header name read from data at run time is
// beyond a static check, which is why rule 1 exists.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const API_FILE = 'src/lib/api.ts';

// Ways to obtain the session token (the SDK's headers, its session, its refresh).
const TOKEN_SOURCES: ReadonlySet<string> = new Set([
  'getHeaders',
  'getHttpClient',
  'getCurrentSession',
  'getSession',
  'refreshSession',
  'userToken',
]);
// Ways to attach it to a request by hand (compared in lower case).
const HEADER_SINKS: ReadonlySet<string> = new Set(['authorization', 'setrequestheader', 'xmlhttprequest', 'buildapirequestinit']);
const SPELLS_AUTH_HEADER = /^\s*authorization\s*$/i;
const SPELLS_BEARER_VALUE = /^\s*bearer(\s|$)/i;

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * The string a node evaluates to when it is made only of literals: a quoted
 * string, a template, `+`, concat(), an array literal's join(), a const that holds
 * one of these. Null as soon as anything else (a parameter, a call) is involved.
 */
function foldString(node: ts.Node, source: ts.SourceFile, depth = 0): string | null {
  if (depth > 6) return null;
  const next = (child: ts.Node) => foldString(child, source, depth + 1);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    return next(node.expression);
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      const part = next(span.expression);
      if (part === null) return null;
      text += part + span.literal.text;
    }
    return text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = next(node.left);
    const right = next(node.right);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isIdentifier(node)) {
    // A const of the same file: `const HEADER = 'Author' + 'ization'`.
    let value: string | null = null;
    const find = (child: ts.Node): void => {
      if (value !== null) return;
      if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === node.text && child.initializer) {
        value = next(child.initializer);
      }
      ts.forEachChild(child, find);
    };
    find(source);
    return value;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    const target = node.expression.expression;
    if (method === 'concat') {
      const parts = [target, ...node.arguments].map(next);
      return parts.every((part): part is string => part !== null) ? parts.join('') : null;
    }
    if (method === 'join' && ts.isArrayLiteralExpression(target)) {
      const parts = target.elements.map(next);
      const separator = node.arguments[0] ? next(node.arguments[0]) : ',';
      return separator !== null && parts.every((part): part is string => part !== null) ? parts.join(separator) : null;
    }
  }
  return null;
}

function spellsTheToken(text: string): string | null {
  if (SPELLS_AUTH_HEADER.test(text)) return 'spells the Authorization header';
  if (SPELLS_BEARER_VALUE.test(text)) return 'builds a bearer value';
  if (TOKEN_SOURCES.has(text) || HEADER_SINKS.has(text.toLowerCase())) return `names ${text} as a string`;
  return null;
}

/** What a source file outside api.ts does that only apiFetch may do. One message per finding. */
function findViolations(file: string, text: string): string[] {
  const source = parse(file, text);
  const found: string[] = [];
  const report = (node: ts.Node, what: string) =>
    found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${what}`);

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (TOKEN_SOURCES.has(node.text)) report(node, `reaches for the session token (${node.text}); ask hasSession() instead`);
      else if (HEADER_SINKS.has(node.text.toLowerCase())) report(node, `sends the token by hand (${node.text}); use apiFetch`);
      return;
    }
    const folded = ts.isTemplateLiteralToken(node) ? node.text : foldString(node, source);
    if (folded !== null) {
      const problem = spellsTheToken(folded);
      if (problem) {
        report(node, `${problem}; use apiFetch`);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// ─── Inside api.ts ───────────────────────────────────────────────────────────

/** Name of the top-level statement a node sits in (`function f`, `const x`, `type T`). */
function holderOf(node: ts.Node, source: ts.SourceFile): string {
  let current: ts.Node = node;
  while (current.parent && current.parent !== source) current = current.parent;
  if (ts.isFunctionDeclaration(current) || ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) return current.name?.text ?? '<anonymous>';
  if (ts.isVariableStatement(current)) {
    const first = current.declarationList.declarations[0]?.name;
    return first && ts.isIdentifier(first) ? first.text : '<variable>';
  }
  return ts.isImportDeclaration(current) ? '<import>' : '<top level>';
}

// Who may touch what inside api.ts. Every other top-level name that mentions one
// of these is a new way to read or send the token.
const API_RULES: ReadonlyArray<readonly [identifier: string, allowed: readonly string[], why: string]> = [
  ['getHeaders', ['InsForgeLikeClient', 'authorizationFrom'], 'only authorizationFrom reads the SDK headers'],
  ['getHttpClient', ['InsForgeLikeClient', 'authorizationFrom'], 'only authorizationFrom reads the SDK headers'],
  ['authorizationFrom', ['hasSession', 'apiFetch'], 'only apiFetch (to send) and hasSession (to answer true or false) may call it'],
  ['withAuthorization', ['apiFetch'], 'only apiFetch attaches the token to a request'],
  ['refreshSession', ['ApiClient', 'runRefresh'], 'only runRefresh refreshes the session'],
  ['accessToken', ['ApiClient', 'runRefresh'], 'only runRefresh looks at a refreshed token'],
  ['fetch', ['apiFetch'], 'only apiFetch sends requests from this file'],
];

function findApiViolations(text: string): string[] {
  const source = parse(API_FILE, text);
  const holders = new Map<string, Set<string>>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const set = holders.get(node.text) ?? new Set<string>();
      set.add(holderOf(node, source));
      holders.set(node.text, set);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const found: string[] = [];
  for (const [identifier, allowed, why] of API_RULES) {
    const strangers = [...(holders.get(identifier) ?? [])].filter((holder) => holder !== identifier && !allowed.includes(holder));
    if (strangers.length > 0) found.push(`${API_FILE}: ${identifier} is used by ${strangers.join(', ')} (${why})`);
  }

  // hasSession is the only way out for the rest of the app: it may say yes or no, never hand out the token.
  const declared = source.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'hasSession',
  );
  if (!declared) found.push(`${API_FILE}: hasSession() is missing`);
  else if (declared.type?.getText(source) !== 'boolean') found.push(`${API_FILE}: hasSession() must be declared to return boolean, so it cannot hand out the token`);
  return found;
}

// ─── The real tree ───────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [relative(process.cwd(), path).split('\\').join('/')] : [];
  });
}

const apiSource = readFileSync(resolve(API_FILE), 'utf8');

describe('authenticated server calls', () => {
  it('attach the session token only through apiFetch, and nothing outside api.ts can reach the token', () => {
    const violations = sourceFiles(resolve('src'))
      .filter((file) => file !== API_FILE)
      .flatMap((file) => findViolations(file, readFileSync(file, 'utf8')));

    expect(violations).toEqual([]);
  });

  it('api.ts reads the token in one place, writes it in one place, and sends with it from apiFetch only', () => {
    expect(findApiViolations(apiSource)).toEqual([]);
  });
});

// ─── The guard itself: every bypass it once missed must be caught now ────────

describe('the guard catches the bypasses the first version missed (D-5)', () => {
  const MISSED: ReadonlyArray<readonly [name: string, code: string]> = [
    ['SDK headers read into a variable, then passed along', "const h = insforge.getHttpClient().getHeaders();\nawait fetch('/api/billing', { headers: h });"],
    [
      'SDK headers through optional calls and a shorthand property (the shape stripe.ts used)',
      "const headers = client.getHttpClient?.().getHeaders?.() || {};\nfetch('/api/portal', { method: 'POST', headers });",
    ],
    ['SDK headers spread into a literal', "fetch('/api/subscription', { headers: { ...insforge.getHttpClient().getHeaders(), 'Content-Type': 'application/json' } });"],
    ['SDK headers reached through a bracket name', "const h = client['getHttpClient']()['getHeaders']();\nfetch('/api/x', { headers: h });"],
    [
      'token from the session, header name concatenated',
      "const s = await insforge.auth.getCurrentSession();\nconst v = ['Bearer', s.data.session.accessToken].join(' ');\nfetch('/api/billing', { headers: new Headers([['Author' + 'ization', v]]) });",
    ],
    ['header name concatenated, token passed in', "const name = 'Author' + 'ization';\nawait fetch('/api/x', { headers: { [name]: t } });"],
    ['header name assembled in a template', "headers.set(`Auth${'orization'}`, t);"],
    ['header name joined from parts', "headers.set(['Author', 'ization'].join(''), t);"],
    ['header name built with concat()', "headers.set('Authori'.concat('zation'), t);"],
    ['header name held in a const and used later', "const HEADER = 'Author' + 'ization';\nheaders.set(HEADER, t);"],
    ['XMLHttpRequest.setRequestHeader with a constant name', "const AUTH = 'Author' + 'ization';\nxhr.setRequestHeader(AUTH, token);"],
    ['XMLHttpRequest.setRequestHeader with a name from elsewhere', 'xhr.setRequestHeader(AUTH_HEADER_NAME, token);'],
    ['Authorization written as a property', "headers.Authorization = 'x';"],
    ['Authorization as an object key', "fetch('/api/x', { headers: { Authorization: t } })"],
    ['Authorization as a quoted name', "headers.set('authorization', t);"],
    ['a bearer value from a template', 'const v = `Bearer ${t}`;'],
    ['a bearer value from concatenation', "const v = 'Bearer ' + t;"],
    ['the SDK headers handed straight to a request', "fetch('/api/x', { headers: insforge.getHttpClient().getHeaders() })"],
    ['the pre-apiFetch helper', "const init = buildApiRequestInit({ method: 'POST' });"],
    ['the SDK refresh called directly', 'await insforge.auth.refreshSession();'],
  ];

  it.each(MISSED)('flags: %s', (_name, code) => {
    expect(findViolations('src/fixture.ts', code), code).not.toEqual([]);
  });

  it('flags the same shapes in a .tsx file', () => {
    expect(findViolations('src/fixture.tsx', "export const A = () => <p>{String(insforge.getHttpClient().getHeaders())}</p>;")).not.toEqual([]);
  });

  it('leaves ordinary code alone', () => {
    const clean = [
      "import { apiFetch, hasSession } from '../lib/api';",
      'export async function load() {',
      "  if (!hasSession()) return null;",
      "  const res = await apiFetch('/api/billing', { signal: AbortSignal.timeout(15000) });",
      "  return res.ok ? res.json() : null;",
      '}',
      "const headers = { 'Content-Type': 'application/json' };",
      "const prose = 'The controller gives prior written authorization for each sub-processor.';",
      "export const Copy = () => <p>Bearer tokens and Authorization headers are never stored.</p>;",
    ].join('\n');
    expect(findViolations('src/clean.tsx', clean)).toEqual([]);
  });
});

describe('the guard also covers api.ts itself (D-5)', () => {
  const add = (code: string) => `${apiSource}\n${code}\n`;

  it('accepts api.ts as it is', () => {
    expect(findApiViolations(apiSource)).toEqual([]);
  });

  it.each([
    [
      'a second wrapper that sends the token',
      "export async function apiFetchLite(path: string, init: RequestInit = {}, client: ApiClient = insforge): Promise<Response> {\n  return fetch(path, withAuthorization(init, authorizationFrom(client)));\n}",
    ],
    ['an export that hands the token out', 'export function currentAuthorization(client: ApiClient = insforge) {\n  return authorizationFrom(client);\n}'],
    [
      'a second reader of the SDK headers',
      "export function sdkHeaders(client: ApiClient = insforge) {\n  return client.getHttpClient?.().getHeaders?.() ?? {};\n}",
    ],
    ['a second place that refreshes the session', 'export async function refreshNow(client: ApiClient = insforge) {\n  return client.auth?.refreshSession?.();\n}'],
    ['a second place that sends requests', "export async function sendBeaconLike(path: string) {\n  return fetch(path, { method: 'POST' });\n}"],
  ])('flags %s', (_name, code) => {
    expect(findApiViolations(add(code)), code).not.toEqual([]);
  });

  it('flags a hasSession that returns the token', () => {
    const leaky = apiSource.replace(/export function hasSession\(([^)]*)\): boolean/, 'export function hasSession($1): string | false');
    expect(leaky).not.toBe(apiSource);
    expect(findApiViolations(leaky)).not.toEqual([]);
  });
});

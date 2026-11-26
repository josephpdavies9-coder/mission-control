/**
 * Asks whether Brittany Ferries sell a Spain-to-Ireland crossing at all.
 *
 * The UK site's catalogue publishes eight ports and not one is Irish, so a
 * Spain-Ireland watch is impossible there. That is evidence about the UK
 * site, not about the operator: the same bebop API is served from the site
 * that sells to Ireland, and the inventory can differ by site. This reads
 * every candidate host's own catalogue and reports which ports each sells.
 *
 * It deliberately asks the operator rather than reasoning from what routes
 * are believed to exist — a Spain-Ireland sailing I "remember" is not a port
 * code I can put in a config.
 *
 * Run: pnpm exec tsx scripts/probe-irish-site.ts
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HOSTS = [
  { name: "UK", host: "www.brittany-ferries.co.uk" },
  { name: "Ireland", host: "www.brittanyferries.ie" },
  { name: "Ireland (alt)", host: "www.brittany-ferries.ie" },
  { name: "France", host: "www.brittany-ferries.fr" },
  { name: "Spain", host: "www.brittany-ferries.es" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Every five-letter port code in a payload, with the name beside it. */
function collectPorts(payload: unknown): Map<string, string> {
  const ports = new Map<string, string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 14) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    for (const [, value] of Object.entries(record)) {
      if (typeof value === "string" && /^[A-Z]{5}$/.test(value)) {
        const name = [record.name, record.label, record.portName, record.title].find(
          (candidate) => typeof candidate === "string" && candidate,
        );
        if (!ports.has(value)) ports.set(value, String(name ?? "?"));
      }
      walk(value, depth + 1);
    }
  };
  walk(payload, 0);
  return ports;
}

const out = (line: string) => process.stdout.write(`${line}\n`);
const allIrish = new Map<string, string>();

for (const { name, host } of HOSTS) {
  const url = `https://${host}/api/bebop/v1/route`;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      redirect: "follow",
    });
    if (!response.ok) {
      out(`${name.padEnd(13)} ${host}: HTTP ${response.status}`);
      continue;
    }
    const payload: unknown = await response.json();
    const ports = collectPorts(payload);
    const irish = [...ports].filter(([code]) => code.startsWith("IE"));
    for (const [code, label] of irish) allIrish.set(code, label);
    out(
      `${name.padEnd(13)} ${host}: ${ports.size} ports` +
        (irish.length > 0
          ? `  IRISH: ${irish.map(([c, l]) => `${c} (${l})`).join(", ")}`
          : "  no Irish ports"),
    );
    out(`              all: ${[...ports.keys()].sort().join(", ")}`);
  } catch (error) {
    out(`${name.padEnd(13)} ${host}: ${(error as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}

out(
  allIrish.size > 0
    ? `\nIrish ports found: ${[...allIrish].map(([c, l]) => `${c} (${l})`).join(", ")}`
    : "\nNo Irish port on any host — Brittany Ferries sell no Ireland crossing through this API.",
);

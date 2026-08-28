/**
 * Port codes as published by Brittany Ferries' own route catalogue
 * (/api/bebop/v1/route). Confirmed against the live endpoint rather than
 * guessed, so a config can name a port in plain English.
 */
export const PORT_CODES: Record<string, string> = {
  portsmouth: "GBPME",
  plymouth: "GBPLY",
  poole: "GBPOO",
  santander: "ESSDR",
  bilbao: "ESBIO",
  caen: "FROUI",
  "st malo": "FRSML",
  cherbourg: "FRCER",
  "le havre": "FRLEH",
  roscoff: "FRROS",
};

/** The only crossings Brittany Ferries run between the UK and Spain. */
export const UK_TO_SPAIN: { from: string; to: string }[] = [
  { from: "GBPME", to: "ESSDR" },
  { from: "GBPME", to: "ESBIO" },
  { from: "GBPLY", to: "ESSDR" },
];

/**
 * Resolves a port name or code to the operator's code. Returns the input
 * unchanged when it is already a code, so a config can use either.
 */
export function toPortCode(nameOrCode: string): string {
  const key = nameOrCode.trim().toLowerCase();
  return PORT_CODES[key] ?? nameOrCode.trim().toUpperCase();
}

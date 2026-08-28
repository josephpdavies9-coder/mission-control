import type { EmailConfig } from "../config.js";
import type { RenderedEmail } from "./template.js";

/** A transport that can put a rendered email in front of the user. */
export interface Mailer {
  readonly id: string;
  send(email: RenderedEmail): Promise<void>;
}

/** Reads a secret from the environment, failing loudly rather than sending nothing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Environment variable ${name} is not set. Export it before running (it holds the mail credential and is deliberately kept out of the config file).`,
    );
  }
  return value;
}

export async function createMailer(config: EmailConfig): Promise<Mailer> {
  const { delivery } = config;

  if (delivery.transport === "console") {
    const { ConsoleMailer } = await import("./console.js");
    return new ConsoleMailer();
  }

  if (delivery.transport === "resend") {
    const { ResendMailer } = await import("./resend.js");
    return new ResendMailer(
      requireEnv(delivery.apiKeyEnv),
      config.from,
      config.to,
    );
  }

  const { SmtpMailer } = await import("./smtp.js");
  return new SmtpMailer(
    {
      host: delivery.host,
      port: delivery.port,
      secure: delivery.secure,
      user: delivery.user,
      password: requireEnv(delivery.passwordEnv),
    },
    config.from,
    config.to,
  );
}

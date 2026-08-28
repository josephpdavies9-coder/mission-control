import type { Mailer } from "./index.js";
import type { RenderedEmail } from "./template.js";

/** Prints instead of sending — used by `--dry-run` and for first-run sanity checks. */
export class ConsoleMailer implements Mailer {
  readonly id = "console";

  async send(email: RenderedEmail): Promise<void> {
    process.stdout.write(
      `\n--- email (not sent) ---\nSubject: ${email.subject}\n\n${email.text}\n------------------------\n\n`,
    );
  }
}

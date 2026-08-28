import type { Mailer } from "./index.js";
import type { RenderedEmail } from "./template.js";

/** HTTPS-only transport — useful where outbound SMTP ports are blocked. */
export class ResendMailer implements Mailer {
  readonly id = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string[],
  ) {}

  async send(email: RenderedEmail): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: this.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend rejected the email (${response.status}): ${detail}`);
    }
  }
}

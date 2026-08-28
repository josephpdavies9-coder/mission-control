import nodemailer, { type Transporter } from "nodemailer";
import type { Mailer } from "./index.js";
import type { RenderedEmail } from "./template.js";

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

/** Works with Gmail app passwords, Fastmail, or any standard SMTP relay. */
export class SmtpMailer implements Mailer {
  readonly id = "smtp";
  private readonly transporter: Transporter;

  constructor(
    options: SmtpOptions,
    private readonly from: string,
    private readonly to: string[],
  ) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: { user: options.user, pass: options.password },
    });
  }

  async send(email: RenderedEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: this.to.join(", "),
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

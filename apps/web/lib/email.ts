import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY ?? "");

const FROM = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function sendInviteEmail(params: {
  email: string;
  inviterName: string;
  orgName: string;
  token: string;
}): Promise<void> {
  const { email, inviterName, orgName, token } = params;

  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping invite email to", email);
    return;
  }

  const acceptUrl = `${APP_URL}/invitations/${token}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `You've been invited to ${orgName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 20px; color: #1a1a1a; margin-bottom: 8px;">
          You're invited!
        </h1>
        <p style="color: #555; line-height: 1.6;">
          <strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on SpielOS.
        </p>
        <p style="color: #555; line-height: 1.6;">
          Click the button below to accept the invitation and get started.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${acceptUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0052cc; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
            Accept Invitation
          </a>
        </div>
        <p style="color: #999; font-size: 12px;">
          This invitation expires in 7 days. If you weren't expecting this, you can ignore this email.
        </p>
      </div>
    `,
  });
}

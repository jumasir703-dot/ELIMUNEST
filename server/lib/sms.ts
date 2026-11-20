export interface SmsSendResult {
  provider: 'webhook' | 'africastalking' | 'console' | 'custom';
}

export class SmsNotConfiguredError extends Error {
  statusCode = 503;
  constructor(
    message = 'SMS delivery is not configured for production. Configure SMS_WEBHOOK_URL or Africa\'s Talking credentials.'
  ) {
    super(message);
  }
}

type SmsSenderFn = (phone: string, text: string) => Promise<SmsSendResult>;
let customSmsSender: SmsSenderFn | null = null;

export function setSmsSenderForTests(fn: SmsSenderFn | null) {
  customSmsSender = fn;
}

export function isSmsProviderConfigured(): boolean {
  if (customSmsSender) return true;
  if (process.env.SMS_WEBHOOK_URL?.trim()) return true;
  if (process.env.AT_API_KEY?.trim() && process.env.AT_USERNAME?.trim()) return true;
  return false;
}

export async function sendSms(phone: string, text: string): Promise<SmsSendResult> {
  if (customSmsSender) {
    return customSmsSender(phone, text);
  }

  const webhookUrl = process.env.SMS_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = process.env.SMS_WEBHOOK_TOKEN?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: phone, message: text }),
    });
    if (!resp.ok) {
      throw new Error(`SMS webhook delivery failed (${resp.status}).`);
    }
    return { provider: 'webhook' };
  }

  const atKey = process.env.AT_API_KEY?.trim();
  const atUsername = process.env.AT_USERNAME?.trim();
  if (atKey && atUsername) {
    const endpoint =
      atUsername === 'sandbox'
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';
    const params = new URLSearchParams({
      username: atUsername,
      to: phone,
      message: text,
    });
    const senderId = process.env.AT_SENDER_ID?.trim();
    if (senderId) {
      params.set('from', senderId);
    }
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey: atKey,
      },
      body: params.toString(),
    });
    if (!resp.ok) {
      throw new Error(`Africa's Talking SMS delivery failed (${resp.status}).`);
    }
    return { provider: 'africastalking' };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new SmsNotConfiguredError();
  }

  // Non-production fallback only: never expose codes in HTTP responses
  if (process.env.NODE_ENV !== 'test') {
    console.info(`[elimuNest DEV SMS] To: ${phone} | ${text}`);
  }
  return { provider: 'console' };
}

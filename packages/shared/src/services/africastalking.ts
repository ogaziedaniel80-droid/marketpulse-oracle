import type { SmsProvider, SendSmsOptions, SmsSendResult } from './index.js';

export interface AfricaTalkingConfig {
  apiKey: string;
  username: string;
  senderId?: string;
  isSandbox?: boolean;
}

export class AfricaTalkingSmsProvider implements SmsProvider {
  private apiKey: string;
  private username: string;
  private senderId?: string;
  private baseUrl: string;

  constructor(config: AfricaTalkingConfig) {
    if (!config.apiKey || !config.username) {
      throw new Error('AfricaTalkingSmsProvider requires apiKey and username');
    }
    this.apiKey = config.apiKey;
    this.username = config.username;
    this.senderId = config.senderId;
    this.baseUrl =
      config.isSandbox || config.username === 'sandbox'
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';
  }

  async sendSms(options: SendSmsOptions): Promise<SmsSendResult> {
    const params = new URLSearchParams();
    params.append('username', this.username);
    params.append('to', options.to);
    params.append('message', options.message);

    const from = options.senderId || this.senderId;
    if (from) {
      params.append('from', from);
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          apiKey: this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        return {
          success: false,
          messageId: '',
          recipient: options.to,
          status: 'Failed',
          cost: undefined,
        };
      }

      const data = (await response.json()) as {
        SMSMessageData: {
          Message: string;
          Recipients: Array<{
            number: string;
            status: string;
            statusCode: number;
            messageId: string;
            cost: string;
          }>;
        };
      };

      const recipient = data.SMSMessageData.Recipients[0];
      const success = recipient ? recipient.status === 'Success' : false;

      return {
        success,
        messageId: recipient ? recipient.messageId : '',
        recipient: recipient ? recipient.number : options.to,
        cost: recipient ? recipient.cost : undefined,
        status: success ? 'Success' : 'Failed',
      };
    } catch (err) {
      return {
        success: false,
        messageId: '',
        recipient: options.to,
        status: 'Failed',
      };
    }
  }

  async verifyDelivery(messageId: string): Promise<boolean> {
    // In live network, delivery status is updated via Africa's Talking incoming delivery webhook
    return !!messageId && messageId.length > 0;
  }
}

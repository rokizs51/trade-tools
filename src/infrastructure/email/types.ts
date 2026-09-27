export type OutboundMailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface MailSender {
  send(message: OutboundMailMessage): Promise<void>;
}

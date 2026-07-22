export type PaymentChannel = 'ussd' | 'dashboard';
export type DemoPaymentKind = 'bank_transfer' | 'airtime' | 'bill_payment';

export type PaymentResult = {
  status: 'completed';
  reference: string;
  processingTime: string;
  description: string;
  receipt: Record<string, string>;
};

export interface PaymentProvider<TRequest> {
  readonly kind: string;
  execute(request: TRequest): Promise<PaymentResult>;
}

export type DemoPaymentRequest = {
  profileId: string;
  sessionId: string;
  amountMinor: bigint;
  currency: 'NGN';
  channel: PaymentChannel;
  details: Record<string, string>;
};

export type OnChainTransferRequest = {
  walletId: string;
  fromAddress: string;
  toAddress: string;
  lamports: bigint;
  referenceId: string;
};

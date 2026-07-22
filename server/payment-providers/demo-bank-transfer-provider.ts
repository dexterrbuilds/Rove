import {demoReference, deterministicChoice, formatNairaMinor, maskValue} from './demo-provider-utils.js';
import type {DemoPaymentRequest, PaymentProvider, PaymentResult} from './types.js';

export const DEMO_BANKS = [
  {key: 'access', label: 'Access Bank'},
  {key: 'gtbank', label: 'GTBank'},
  {key: 'firstbank', label: 'First Bank'},
  {key: 'zenith', label: 'Zenith Bank'},
] as const;

const DEMO_ACCOUNT_NAMES = ['Amina Okafor', 'David Adeyemi', 'Chiamaka Bello', 'Ibrahim Musa', 'Tolu Williams'] as const;

export class DemoBankTransferProvider implements PaymentProvider<DemoPaymentRequest> {
  readonly kind = 'bank_transfer';

  resolveAccount(bankKey: string, accountNumber: string) {
    const bank = DEMO_BANKS.find((candidate) => candidate.key === bankKey);
    if (!bank || !/^\d{10}$/.test(accountNumber)) return null;
    return {
      bankKey: bank.key,
      bankName: bank.label,
      accountName: deterministicChoice(`${bank.key}:${accountNumber}`, DEMO_ACCOUNT_NAMES),
      accountNumber,
    };
  }

  async execute(request: DemoPaymentRequest): Promise<PaymentResult> {
    const resolved = this.resolveAccount(request.details.bankKey, request.details.accountNumber);
    if (!resolved || resolved.accountName !== request.details.accountName) throw new Error('Demo bank recipient resolution changed.');
    const reference = demoReference('BANK');
    return {
      status: 'completed',
      reference,
      processingTime: 'Estimated arrival: under 2 minutes',
      description: `Demo transfer to ${resolved.bankName}`,
      receipt: {
        reference,
        bank: resolved.bankName,
        account: maskValue(resolved.accountNumber),
        accountName: resolved.accountName,
        amount: formatNairaMinor(request.amountMinor),
        status: 'Demo Successful',
      },
    };
  }
}

export const demoBankTransferProvider = new DemoBankTransferProvider();

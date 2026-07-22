import {demoReference, formatNairaMinor, maskValue} from './demo-provider-utils.js';
import type {DemoPaymentRequest, PaymentProvider, PaymentResult} from './types.js';

export const DEMO_BILL_CATEGORIES = [
  {key: 'electricity', label: 'Electricity'},
  {key: 'dstv', label: 'DSTV'},
  {key: 'gotv', label: 'GOtv'},
  {key: 'internet', label: 'Internet'},
  {key: 'water', label: 'Water'},
  {key: 'education', label: 'Education'},
] as const;

export class DemoBillsProvider implements PaymentProvider<DemoPaymentRequest> {
  readonly kind = 'bill_payment';

  async execute(request: DemoPaymentRequest): Promise<PaymentResult> {
    const category = DEMO_BILL_CATEGORIES.find((candidate) => candidate.key === request.details.categoryKey);
    if (!category || !/^[A-Za-z0-9-]{4,32}$/.test(request.details.customerId)) throw new Error('Invalid demo bill recipient.');
    const reference = demoReference('BILL');
    return {
      status: 'completed',
      reference,
      processingTime: 'Confirmation generated instantly',
      description: `${category.label} payment (Demo)`,
      receipt: {
        reference,
        category: category.label,
        customerId: maskValue(request.details.customerId),
        amount: formatNairaMinor(request.amountMinor),
        status: 'Demo Successful',
      },
    };
  }
}

export const demoBillsProvider = new DemoBillsProvider();

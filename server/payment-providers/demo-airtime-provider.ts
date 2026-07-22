import {demoReference, formatNairaMinor, maskValue} from './demo-provider-utils.js';
import type {DemoPaymentRequest, PaymentProvider, PaymentResult} from './types.js';

export const DEMO_AIRTIME_NETWORKS = [
  {key: 'mtn', label: 'MTN'},
  {key: 'airtel', label: 'Airtel'},
  {key: 'glo', label: 'Glo'},
  {key: '9mobile', label: '9mobile'},
] as const;

export class DemoAirtimeProvider implements PaymentProvider<DemoPaymentRequest> {
  readonly kind = 'airtime';

  async execute(request: DemoPaymentRequest): Promise<PaymentResult> {
    const network = DEMO_AIRTIME_NETWORKS.find((candidate) => candidate.key === request.details.networkKey);
    if (!network || !/^\+[1-9]\d{7,14}$/.test(request.details.phoneNumber)) throw new Error('Invalid demo airtime recipient.');
    const reference = demoReference('AIR');
    return {
      status: 'completed',
      reference,
      processingTime: 'Delivered instantly',
      description: `${network.label} airtime (Demo)`,
      receipt: {
        reference,
        network: network.label,
        phone: maskValue(request.details.phoneNumber),
        amount: formatNairaMinor(request.amountMinor),
        status: 'Demo Successful',
      },
    };
  }
}

export const demoAirtimeProvider = new DemoAirtimeProvider();

import {demoAirtimeProvider} from './demo-airtime-provider.js';
import {demoBankTransferProvider} from './demo-bank-transfer-provider.js';
import {demoBillsProvider} from './demo-bills-provider.js';
import type {DemoPaymentKind, PaymentProvider, DemoPaymentRequest} from './types.js';

const demoProviders: Record<DemoPaymentKind, PaymentProvider<DemoPaymentRequest>> = {
  bank_transfer: demoBankTransferProvider,
  airtime: demoAirtimeProvider,
  bill_payment: demoBillsProvider,
};

export function getDemoPaymentProvider(kind: DemoPaymentKind) {
  return demoProviders[kind];
}

export {DEMO_AIRTIME_NETWORKS} from './demo-airtime-provider.js';
export {DEMO_BANKS, demoBankTransferProvider} from './demo-bank-transfer-provider.js';
export {DEMO_BILL_CATEGORIES} from './demo-bills-provider.js';
export {onChainTransferProvider, OnChainTransferProvider} from './on-chain-transfer-provider.js';
export type {DemoPaymentKind, DemoPaymentRequest, PaymentProvider, PaymentResult} from './types.js';

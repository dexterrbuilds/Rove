import {describe, expect, it} from 'vitest';
import {demoAirtimeProvider} from './demo-airtime-provider.js';
import {demoBankTransferProvider} from './demo-bank-transfer-provider.js';
import {demoBillsProvider} from './demo-bills-provider.js';

const baseRequest = {
  profileId: 'profile-1',
  sessionId: 'session-1',
  amountMinor: 250_000n,
  currency: 'NGN' as const,
  channel: 'ussd' as const,
};

describe('replaceable demo payment providers', () => {
  it('resolves the same fake bank account deterministically and generates a receipt', async () => {
    const first = demoBankTransferProvider.resolveAccount('access', '0123456789');
    const second = demoBankTransferProvider.resolveAccount('access', '0123456789');
    expect(first).toEqual(second);
    const result = await demoBankTransferProvider.execute({
      ...baseRequest,
      details: {bankKey: 'access', accountNumber: '0123456789', accountName: first!.accountName},
    });
    expect(result.status).toBe('completed');
    expect(result.reference).toMatch(/^RVE-BANK-/);
    expect(result.receipt.account).not.toContain('0123456789');
  });

  it('generates airtime and bill receipts through the common provider contract', async () => {
    const airtime = await demoAirtimeProvider.execute({...baseRequest, details: {networkKey: 'mtn', phoneNumber: '+2348012345678'}});
    const bill = await demoBillsProvider.execute({...baseRequest, details: {categoryKey: 'electricity', customerId: 'METER-12345'}});
    expect(airtime.reference).toMatch(/^RVE-AIR-/);
    expect(bill.reference).toMatch(/^RVE-BILL-/);
    expect(airtime.receipt.status).toBe('Demo Successful');
    expect(bill.receipt.status).toBe('Demo Successful');
  });

  it('fails closed on invalid provider details', async () => {
    await expect(demoAirtimeProvider.execute({...baseRequest, details: {networkKey: 'unknown', phoneNumber: '+2348012345678'}})).rejects.toThrow();
    await expect(demoBillsProvider.execute({...baseRequest, details: {categoryKey: 'electricity', customerId: 'x'}})).rejects.toThrow();
  });
});

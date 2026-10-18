import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field } from '../../src/client/components/ui.jsx';
import { inputCents } from '../../src/shared/numerals.mjs';
import { readFormValues } from '../../src/client/lib/form-values.js';

function Form({ save }) {
  const [amount, setAmount] = useState('');
  return <form onSubmit={(event) => { event.preventDefault(); save(readFormValues(event.currentTarget)); }}>
    <Field label="المبلغ"><input name="amount" type="number" min="0" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
    <Field label="العدد"><input name="count" type="number" min="1" max="600" step="1" defaultValue="1" /></Field>
    <Field label="الكيلومترات"><input name="odometer_km" type="number" min="0" step="1" /></Field>
    <Field label="الهاتف"><input name="phone" type="tel" defaultValue="٠٠٥٠۱۲۳" /></Field>
    <Field label="التاريخ"><input name="date" type="date" defaultValue="2026-10-17" /></Field>
    <Field label="الملاحظة"><textarea name="note" defaultValue="عقد ٠٠١" /></Field>
    <button type="submit">حفظ</button>
  </form>;
}

describe('localized input through shared fields', () => {
  it('accepts Arabic typing and Persian paste, retaining exact cents and identifier zeros', async () => {
    const user = userEvent.setup(), save = vi.fn();
    render(<Form save={save} />);
    const amount = screen.getByLabelText('المبلغ');
    await user.type(amount, '١٢٣٤٫٥٠');
    expect(amount).toHaveValue('1234.50');
    await user.clear(amount);
    await user.paste('۱٬۲۳۴٫۵۰');
    expect(amount).toHaveValue('1,234.50');
    expect(screen.getByLabelText('الهاتف')).toHaveValue('0050123');
    expect(screen.getByLabelText('الملاحظة')).toHaveValue('عقد 001');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    const body = save.mock.calls[0][0];
    expect(inputCents(body.amount)).toBe(123450);
    expect(body.phone).toBe('0050123');
    expect(body.date).toBe('2026-10-17');
  });

  it('blocks malformed grouping and preserves integer bounds previously handled by type=number', async () => {
    const user = userEvent.setup(), save = vi.fn();
    render(<Form save={save} />);
    const amount = screen.getByLabelText('المبلغ'), count = screen.getByLabelText('العدد');
    fireEvent.change(amount, { target: { value: '١٢٬٣٤' } });
    expect(amount).toHaveValue('12,34');
    expect(amount).toBeInvalid();
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '١٫١٠' } });
    fireEvent.change(count, { target: { value: '٦٠١' } });
    expect(count).toBeInvalid();
    fireEvent.change(count, { target: { value: '١٫٥' } });
    expect(count).toBeInvalid();
    fireEvent.change(count, { target: { value: '٦٠٠' } });
    expect(count).toBeValid();
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ count: '600', amount: '1.10' }));
  });

  it('keeps the native calendar and normalizes explicit Arabic ISO date paste', () => {
    render(<Form save={vi.fn()} />);
    const date = screen.getByLabelText('التاريخ');
    expect(date).toHaveAttribute('type', 'date');
    expect(date).toHaveAttribute('lang', 'en-GB');
    fireEvent.paste(date, { clipboardData: { getData: () => '٢٠٢٦-١١-٠٥' } });
    expect(date).toHaveValue('2026-11-05');
    fireEvent.paste(date, { clipboardData: { getData: () => '٢٠٢٦-٠٢-٣٠' } });
    expect(date).toHaveValue('2026-11-05');
  });

  it('allows typing multiple integer groups and canonicalizes only after leaving the field', async () => {
    const user = userEvent.setup(), save = vi.fn();
    render(<Form save={save} />);
    await user.type(screen.getByLabelText('المبلغ'), '1.10');
    const odometer = screen.getByLabelText('الكيلومترات');
    await user.type(odometer, '١٬٢٣٤٬٥٦٧');
    expect(odometer).toHaveValue('1,234,567');
    expect(odometer).toBeValid();
    await user.tab();
    expect(odometer).toHaveValue('1234567');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ odometer_km: '1234567', phone: '0050123' }));
  });

  it('submits a grouped quantity with Enter before blur without changing identifiers', async () => {
    const user = userEvent.setup(), save = vi.fn();
    render(<Form save={save} />);
    await user.type(screen.getByLabelText('المبلغ'), '1,234.50');
    const odometer = screen.getByLabelText('الكيلومترات');
    await user.type(odometer, '1,234,567');
    expect(odometer).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ amount: '1234.50', odometer_km: '1234567', phone: '0050123' }));
  });
});

// Keep input comparisons in integer halalas, matching the API's money format.
export function inputCents(value) {
  const text=String(value??'').trim();
  if(!/^\d+(\.\d{1,2})?$/.test(text))throw new Error('أدخل مبلغًا صحيحًا بحد أقصى منزلتين عشريتين');
  const [whole,fraction='']=text.split('.');
  const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount<0||amount>1e13)throw new Error('المبلغ خارج النطاق المسموح');
  return amount;
}

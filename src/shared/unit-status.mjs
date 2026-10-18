export const unitStatusNames = {
  available: 'متاحة', rented: 'مؤجرة', maintenance: 'صيانة',
  personal_use: 'استخدام شخصي', unavailable: 'غير متاحة',
};

// Expiry and payment never release possession: an explicit saved vacancy does.
export function occupiesUnit(agreement, day) {
  return agreement.kind === 'rent' && agreement.status === 'active'
    && !agreement.closed_at && !agreement.vacated_at && !agreement.booking_cancelled_at && agreement.start_date <= day
    && (agreement.rental_mode !== 'daily' || agreement.end_date >= day);
}

export function rentalPeriodsOverlap(a, b, day) {
  if (a.booking_cancelled_at || b.booking_cancelled_at) return false;
  const end = rental => rental.rental_mode === 'daily' ? rental.end_date : rental.vacated_on
    ? new Date(Date.parse(rental.vacated_on + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
    : (rental.end_date > day ? rental.end_date : day);
  return end(a) >= a.start_date && end(b) >= b.start_date
    && a.start_date <= end(b) && b.start_date <= end(a);
}

export function effectiveUnitStatus(unit, agreements = [], day) {
  const manual = unit.manual_status ?? unit.status;
  if (['maintenance', 'personal_use', 'unavailable'].includes(manual)) return manual;
  return agreements.some(a => (a.entity_id === unit.id || (a.rental_mode === 'daily' && a.entity_id === unit.parent_id)) && occupiesUnit(a, day))
    ? 'rented' : 'available';
}

// A daily reservation covers the whole rest house, including any existing units.
export function sameRentalSpace(a, b, entities) {
  if (a.entity_id === b.entity_id) return true;
  const entity = id => entities.find(e => e.id === id);
  return (a.rental_mode === 'daily' && entity(b.entity_id)?.parent_id === a.entity_id)
    || (b.rental_mode === 'daily' && entity(a.entity_id)?.parent_id === b.entity_id);
}

export function restHouseAvailability(property, entities, agreements, day, today = day) {
  const blocked = [property, ...entities.filter(e => e.parent_id === property.id && !e.archived)]
    .find(e => ['maintenance', 'personal_use', 'unavailable'].includes(e.manual_status ?? e.status));
  if (blocked) return { status: blocked.manual_status ?? blocked.status, booking: null };
  const candidate = {entity_id:property.id, rental_mode:'daily', start_date:day, end_date:day};
  const booking = agreements.find(a => a.kind === 'rent' && a.status === 'active' && !a.closed_at
    && sameRentalSpace(candidate, a, entities) && rentalPeriodsOverlap(candidate, a, today));
  return {status:booking ? 'rented' : 'available', booking:booking ?? null};
}

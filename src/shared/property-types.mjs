export const propertyTypes = [
  ['building', 'عمارات', 'عمارة'],
  ['house', 'بيوت', 'بيت'],
  ['rest_house', 'استراحات', 'استراحة'],
];
export const propertyTypeNames = Object.fromEntries(propertyTypes.map(([key, , singular]) => [key, singular]));
export const propertyTypeLabel = entity => propertyTypeNames[entity?.property_type] || 'عقار غير مصنف';

// Classification is descriptive: IDs, unit parentage and financial links stay
// intact. Legacy properties and standalone units remain reachable in All.
export function filterPropertyData(data, type = 'all') {
  if (type === 'all') return data;
  const properties = new Set(data.entities.filter(entity => entity.kind === 'property' &&
    (type === 'unclassified' ? !entity.property_type : entity.property_type === type)).map(entity => entity.id));
  return {...data, entities:data.entities.filter(entity => properties.has(entity.id) ||
    (entity.kind === 'unit' && properties.has(entity.parent_id)))};
}

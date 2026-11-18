export type ProductDetail = { name: string; quantity: string; value: string; source: string }
export function productDetails(properties: Record<string, string | null | undefined>, label: (field: string, value: string) => string): ProductDetail[] {
  const details: ProductDetail[] = []
  const slots = [
    ['nombre_producto_1', 'cantidad_producto_1', 'valor_producto_1'],
    ['desired_treatment_1', 'quantity_desired_treatment_1', 'value_desired_treatment_1'],
    ['desired_treatment_2', 'quantity_desired_treatment_2', 'value_desired_treatment_2'],
    ['desired_treatment_3', 'quantity_desired_treatment_3', 'value_desired_treatment_3'],
    ['desired_treatment_form', 'quantity_desired_treatment_form', 'value_desired_treatment_form'],
    ['desired_treatment_single_purchase_1', 'quantity_desired_treatment_single_purchase_1', 'value_desired_treatment_single_purchase_1'],
  ]
  for (const [field, quantityField, valueField] of slots) {
    const names = String(properties[field] ?? '').split(';').map(value => label(field, value).trim()).filter(Boolean)
    for (const name of names) details.push({ name, quantity: names.length === 1 ? String(properties[quantityField] ?? '').trim() : '', value: names.length === 1 ? String(properties[valueField] ?? '').trim() : '', source: field })
  }
  for (const field of ['desired_treatment', 'tipo_de_tratamiento']) {
    if (field === 'tipo_de_tratamiento' && details.length) continue
    for (const value of String(properties[field] ?? '').split(';')) {
      const name = label(field, value).trim()
      if (name && !details.some(detail => detail.name.toLowerCase() === name.toLowerCase())) details.push({ name, quantity: '', value: '', source: field })
    }
  }
  return details
}
export function productText(details: ProductDetail[]) { return [...new Set(details.map(detail => detail.name))].join('; ') || 'WLI' }

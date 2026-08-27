export type PricingBasis = "Per day" | "Per event";
export const productTypes = ["Quantity-wise", "Length-wise", "Area-based"] as const;
export type ProductType = (typeof productTypes)[number];

export function isProductType(value: unknown): value is ProductType {
  return productTypes.includes(String(value ?? "") as ProductType);
}

export function measurementLabel(productType: ProductType) {
  if (productType === "Length-wise") return "Length";
  if (productType === "Area-based") return "Area";
  return "Quantity";
}

export function normalizeMeasurement(value: unknown, productType: ProductType) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return productType === "Quantity-wise" ? Math.max(1, Math.round(parsed)) : Math.round(parsed * 100) / 100;
}

export function calculateTentativeCost(
  rentalCharge: number,
  pricingBasis: PricingBasis,
  measurement: number,
  rentalDays: number,
) {
  const rate = Math.max(0, Math.round(Number(rentalCharge) || 0));
  const units = Math.max(0, Number(measurement) || 0);
  const days = pricingBasis === "Per day" ? Math.max(1, Math.round(Number(rentalDays) || 1)) : 1;
  return Math.round(rate * units * days);
}

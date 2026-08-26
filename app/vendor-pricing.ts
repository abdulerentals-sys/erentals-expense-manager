export type PricingBasis = "Per day" | "Per event";

export function calculateTentativeCost(
  rentalCharge: number,
  pricingBasis: PricingBasis,
  quantity: number,
  rentalDays: number,
) {
  const rate = Math.max(0, Math.round(Number(rentalCharge) || 0));
  const units = Math.max(1, Math.round(Number(quantity) || 1));
  const days = pricingBasis === "Per day" ? Math.max(1, Math.round(Number(rentalDays) || 1)) : 1;
  return rate * units * days;
}

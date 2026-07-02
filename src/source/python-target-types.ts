import type { TargetTypeRef } from "@tsonic/tsts";

export function isPythonNoneCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "tuple" && carrier.elements.length === 0;
}

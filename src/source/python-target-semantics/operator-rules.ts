import type { TargetTypeRef } from "@tsonic/tsts";
import {
  KindAmpersandAmpersandToken,
  KindAsteriskToken,
  KindBarBarToken,
  KindEqualsEqualsEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindGreaterThanEqualsToken,
  KindGreaterThanToken,
  KindLessThanEqualsToken,
  KindLessThanToken,
  KindMinusToken,
  KindPercentToken,
  KindPlusToken,
  KindSlashToken,
} from "../../common/source-ast.js";
import {
  isPythonBoolCarrier,
  isPythonIntegerCarrier,
  isPythonNumericCarrier,
  isPythonStrCarrier,
  pythonSourcePrimitiveTargetType,
  samePythonPrimitiveCarrier,
} from "../python-target-types.js";

export interface PythonBinaryOperatorSelection {
  readonly kind: "operator-token" | "string-concat";
  readonly pythonOperator: string;
  readonly resultCarrier: TargetTypeRef;
}

const arithmeticTokens: Readonly<Record<string, string>> = {
  [KindPlusToken]: "+",
  [KindMinusToken]: "-",
  [KindAsteriskToken]: "*",
  [KindSlashToken]: "/",
  [KindPercentToken]: "%",
};

const comparisonTokens: Readonly<Record<string, string>> = {
  [KindLessThanToken]: "<",
  [KindLessThanEqualsToken]: "<=",
  [KindGreaterThanToken]: ">",
  [KindGreaterThanEqualsToken]: ">=",
};

const equalityTokens: Readonly<Record<string, string>> = {
  [KindEqualsEqualsEqualsToken]: "==",
  [KindExclamationEqualsEqualsToken]: "!=",
};

const logicalTokens: Readonly<Record<string, string>> = {
  [KindAmpersandAmpersandToken]: "and",
  [KindBarBarToken]: "or",
};

const boolCarrier = pythonSourcePrimitiveTargetType("bool");

export function selectPythonBinaryOperator(
  operatorKindName: string,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
): PythonBinaryOperatorSelection | undefined {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const arithmetic = arithmeticTokens[operatorKindName];
  if (arithmetic !== undefined) {
    if (operatorKindName === KindPlusToken && isPythonStrCarrier(left) && isPythonStrCarrier(right)) {
      return { kind: "string-concat", pythonOperator: "+", resultCarrier: left };
    }
    if (isPythonNumericCarrier(left) && samePythonPrimitiveCarrier(left, right)) {
      // TS `/` on statically-integer carriers keeps the integer carrier, so
      // the Python spelling is floor division; float carriers keep `/`.
      const pythonOperator = operatorKindName === KindSlashToken && isPythonIntegerCarrier(left)
        ? "//"
        : arithmetic;
      return { kind: "operator-token", pythonOperator, resultCarrier: left };
    }
    return undefined;
  }
  const comparison = comparisonTokens[operatorKindName];
  if (comparison !== undefined) {
    return isPythonNumericCarrier(left) && samePythonPrimitiveCarrier(left, right)
      ? { kind: "operator-token", pythonOperator: comparison, resultCarrier: boolCarrier }
      : undefined;
  }
  const equality = equalityTokens[operatorKindName];
  if (equality !== undefined) {
    const comparable =
      (isPythonNumericCarrier(left) && samePythonPrimitiveCarrier(left, right)) ||
      (isPythonBoolCarrier(left) && isPythonBoolCarrier(right)) ||
      (isPythonStrCarrier(left) && isPythonStrCarrier(right));
    return comparable
      ? { kind: "operator-token", pythonOperator: equality, resultCarrier: boolCarrier }
      : undefined;
  }
  const logical = logicalTokens[operatorKindName];
  if (logical !== undefined) {
    return isPythonBoolCarrier(left) && isPythonBoolCarrier(right)
      ? { kind: "operator-token", pythonOperator: logical, resultCarrier: boolCarrier }
      : undefined;
  }
  return undefined;
}

const pythonSignedNumericKinds: ReadonlySet<string> = new Set([
  "int8",
  "int16",
  "int32",
  "int64",
  "float32",
  "float64",
]);

export function isPythonSignedNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && pythonSignedNumericKinds.has(carrier.name);
}

export function pythonOperatorCarrierKey(carrier: TargetTypeRef): string {
  if (carrier.kind === "source-primitive") {
    return carrier.name;
  }
  if (carrier.kind === "target-named") {
    return carrier.id;
  }
  return carrier.kind;
}

export type MatrixState = "raw" | "normalized" | "log_normalized";
export type MatrixStateConfidence = "high" | "medium" | "low";

export type MatrixStateDetection = {
  detectedState: MatrixState | null;
  confidence: MatrixStateConfidence;
  reasons: string[];
  metrics?: {
    sampledValues: number;
    integerFraction: number;
    negativeValues: number;
    maximumValue: number;
    linearSumCv: number | null;
    inverseLogSumCv: number | null;
    inverseLogBase: "natural" | "2" | "10" | null;
  };
};

export type ExpressionMatrixInspection = {
  label: string;
  geneCount: number;
  cellCount: number;
  geneNames: string[];
  detection: MatrixStateDetection;
};

const MAX_SAMPLED_CELLS = 96;
const INTEGER_TOLERANCE = 1e-6;

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === delimiter && !insideQuotes) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  fields.push(value);
  return fields;
}

function countDelimitedFields(line: string, delimiter: string): number {
  return parseDelimitedLine(line, delimiter).length;
}

function detectDelimiter(header: string): string {
  return [",", "\t", ";"].reduce((bestDelimiter, delimiter) =>
    countDelimitedFields(header, delimiter) >
    countDelimitedFields(header, bestDelimiter)
      ? delimiter
      : bestDelimiter,
  );
}

function sampleColumnIndexes(cellCount: number): number[] {
  if (cellCount <= MAX_SAMPLED_CELLS) {
    return Array.from({ length: cellCount }, (_, index) => index);
  }
  const indexes = new Set<number>();
  for (let index = 0; index < MAX_SAMPLED_CELLS; index += 1) {
    indexes.add(
      Math.round((index * (cellCount - 1)) / (MAX_SAMPLED_CELLS - 1)),
    );
  }
  return [...indexes].sort((left, right) => left - right);
}

function coefficientOfVariation(values: number[]): number | null {
  const positiveValues = values.filter(
    (value) => value > 0 && Number.isFinite(value),
  );
  if (positiveValues.length < 2) return null;
  const mean =
    positiveValues.reduce((sum, value) => sum + value, 0) /
    positiveValues.length;
  if (mean <= 0) return null;
  const variance =
    positiveValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    positiveValues.length;
  return Math.sqrt(variance) / mean;
}

function classifyMatrixState({
  sampledValueCount,
  integerLikeCount,
  negativeCount,
  maximumValue,
  linearColumnSums,
  inverseLogCandidates,
}: {
  sampledValueCount: number;
  integerLikeCount: number;
  negativeCount: number;
  maximumValue: number;
  linearColumnSums: number[];
  inverseLogCandidates: Partial<
    Record<"natural" | "2" | "10", number[]>
  >;
}): MatrixStateDetection {
  if (sampledValueCount <= 0) {
    return {
      detectedState: null,
      confidence: "low",
      reasons: ["Not enough numeric values were available to classify the matrix."],
    };
  }

  const integerFraction = integerLikeCount / sampledValueCount;
  const linearSumCv = coefficientOfVariation(linearColumnSums);
  const inverseLogCvs = Object.entries(inverseLogCandidates)
    .map(([base, values]) => ({
      base: base as "natural" | "2" | "10",
      cv: coefficientOfVariation(values),
    }))
    .filter(
      (candidate): candidate is {
        base: "natural" | "2" | "10";
        cv: number;
      } => candidate.cv !== null,
    );
  const bestInverseLog = inverseLogCvs.reduce<
    { base: "natural" | "2" | "10"; cv: number } | null
  >(
    (best, candidate) =>
      best === null || candidate.cv < best.cv ? candidate : best,
    null,
  );
  const inverseLogSumCv = bestInverseLog?.cv ?? null;
  const metrics = {
    sampledValues: sampledValueCount,
    integerFraction,
    negativeValues: negativeCount,
    maximumValue,
    linearSumCv,
    inverseLogSumCv,
    inverseLogBase: bestInverseLog?.base ?? null,
  };

  if (negativeCount > 0) {
    return {
      detectedState: null,
      confidence: "low",
      reasons: [
        "Negative values suggest scaled or centered data.",
        "Choose the original state only if you know how the matrix was prepared.",
      ],
      metrics,
    };
  }

  const linearSumsAreConstant = linearSumCv !== null && linearSumCv <= 0.03;
  const inverseSumsAreConstant =
    inverseLogSumCv !== null && inverseLogSumCv <= 0.03;
  const inverseIsClearlyBetter =
    inverseLogSumCv !== null &&
    linearSumCv !== null &&
    inverseLogSumCv <= Math.max(0.01, linearSumCv * 0.45);

  if (integerFraction >= 0.999) {
    if (linearSumsAreConstant) {
      return {
        detectedState: "normalized",
        confidence: "medium",
        reasons: [
          "Values are integer-like, but cell totals are nearly constant.",
          "This looks more like rounded normalized data than raw counts.",
        ],
        metrics,
      };
    }
    return {
      detectedState: "raw",
      confidence: "high",
      reasons: [
        "Nearly all sampled values are non-negative integers.",
        "Cell totals vary, which is typical of raw counts.",
      ],
      metrics,
    };
  }

  if (inverseSumsAreConstant && inverseIsClearlyBetter) {
    return {
      detectedState: "log_normalized",
      confidence: "high",
      reasons: [
        "Values are non-integer and compressed.",
        "Reversing log1p produces nearly constant cell totals.",
      ],
      metrics,
    };
  }

  if (linearSumsAreConstant) {
    return {
      detectedState: "normalized",
      confidence: "high",
      reasons: [
        "Values are non-integer and cell totals are nearly constant.",
        "This is typical of library-size normalized expression.",
      ],
      metrics,
    };
  }

  if (maximumValue <= 30) {
    return {
      detectedState: "log_normalized",
      confidence: "medium",
      reasons: [
        "Values are non-integer with a compressed non-negative range.",
        "The exact normalization method cannot be proven from values alone.",
      ],
      metrics,
    };
  }

  return {
    detectedState: "normalized",
    confidence: "medium",
    reasons: [
      "Values are non-integer and remain on an uncompressed scale.",
      "The exact normalization method cannot be proven from values alone.",
    ],
    metrics,
  };
}

export async function inspectExpressionMatrix(
  file: File,
): Promise<ExpressionMatrixInspection> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let pendingText = "";
  let header: string | null = null;
  let delimiter = ",";
  let geneCount = 0;
  const geneNames: string[] = [];
  let cellCount = 0;
  let sampledIndexes: number[] = [];
  let linearSums: number[] = [];
  let inverseSums: Record<"natural" | "2" | "10", number[]> = {
    natural: [],
    "2": [],
    "10": [],
  };
  const inverseSumsAvailable: Record<"natural" | "2" | "10", boolean> = {
    natural: true,
    "2": true,
    "10": true,
  };
  let sampledValueCount = 0;
  let integerLikeCount = 0;
  let negativeCount = 0;
  let maximumValue = 0;

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) return;

    if (header === null) {
      header = line.replace(/^\uFEFF/, "");
      delimiter = detectDelimiter(header);
      cellCount = Math.max(
        0,
        countDelimitedFields(header, delimiter) - 1,
      );
      sampledIndexes = sampleColumnIndexes(cellCount);
      linearSums = sampledIndexes.map(() => 0);
      inverseSums = {
        natural: sampledIndexes.map(() => 0),
        "2": sampledIndexes.map(() => 0),
        "10": sampledIndexes.map(() => 0),
      };
      return;
    }

    geneCount += 1;
    const fields = parseDelimitedLine(line, delimiter);
    const geneName = fields[0]?.trim();
    if (geneName) geneNames.push(geneName);
    sampledIndexes.forEach((cellIndex, samplePosition) => {
      const rawValue = fields[cellIndex + 1]?.trim();
      if (!rawValue) return;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return;

      sampledValueCount += 1;
      if (value < 0) negativeCount += 1;
      if (Math.abs(value - Math.round(value)) <= INTEGER_TOLERANCE) {
        integerLikeCount += 1;
      }
      maximumValue = Math.max(maximumValue, value);
      linearSums[samplePosition] += value;

      if (inverseSumsAvailable.natural && value >= 0 && value <= 50) {
        inverseSums.natural[samplePosition] += Math.expm1(value);
      } else {
        inverseSumsAvailable.natural = false;
      }
      if (inverseSumsAvailable["2"] && value >= 0 && value <= 100) {
        inverseSums["2"][samplePosition] += 2 ** value - 1;
      } else {
        inverseSumsAvailable["2"] = false;
      }
      if (inverseSumsAvailable["10"] && value >= 0 && value <= 20) {
        inverseSums["10"][samplePosition] += 10 ** value - 1;
      } else {
        inverseSumsAvailable["10"] = false;
      }
    });
  };

  while (true) {
    const { value, done } = await reader.read();
    pendingText += decoder.decode(value, { stream: !done });
    const lines = pendingText.split("\n");
    pendingText = lines.pop() ?? "";
    lines.forEach(processLine);
    if (done) break;
  }

  if (pendingText) processLine(pendingText);
  if (header === null) throw new Error("The expression matrix is empty.");

  return {
    label: `${geneCount.toLocaleString()} genes × ${cellCount.toLocaleString()} cells`,
    geneCount,
    cellCount,
    geneNames,
    detection: classifyMatrixState({
      sampledValueCount,
      integerLikeCount,
      negativeCount,
      maximumValue,
      linearColumnSums: linearSums,
      inverseLogCandidates: Object.fromEntries(
        (
          Object.entries(inverseSums) as [
            "natural" | "2" | "10",
            number[],
          ][]
        ).filter(([base]) => inverseSumsAvailable[base]),
      ),
    }),
  };
}

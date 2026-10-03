import type { DisplayResult } from "@bayarlab/engine";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface StepReport {
  index: number;
  type: "event" | "wait";
  name: string;
  passed: boolean;
  failures: string[];
  result?: DisplayResult;
  durationMs: number;
}

export interface ScenarioReport {
  file: string;
  provider: string;
  passed: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  steps: StepReport[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

export function formatReportText(report: ScenarioReport): string {
  const lines: string[] = [];
  lines.push(`Scenario: ${report.file}`);
  lines.push(`Provider: ${report.provider}`);
  lines.push("");

  for (const step of report.steps) {
    const status = step.passed ? "✓" : "✗";
    const timing = `${step.durationMs}ms`;
    if (step.type === "wait") {
      lines.push(`  ${status} ${step.name}`);
    } else {
      const httpStatus = step.result?.response?.status;
      const statusPart = httpStatus !== undefined ? ` → HTTP ${httpStatus}` : "";
      lines.push(`  ${status} ${step.name}${statusPart} (${timing})`);
    }
    for (const failure of step.failures) {
      lines.push(`    FAIL: ${failure}`);
    }
  }

  lines.push("");
  lines.push(
    `${report.passed ? "PASS" : "FAIL"} — ${report.summary.passed}/${report.summary.total} steps passed (${report.durationMs}ms)`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

export function formatReportJson(report: ScenarioReport): string {
  return JSON.stringify(report);
}

// ---------------------------------------------------------------------------
// JUnit XML formatter
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatReportJunit(report: ScenarioReport): string {
  return formatReportsJunit([report]);
}

function formatReportsJunit(reports: readonly ScenarioReport[]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites tests="${reports.reduce((sum, report) => sum + report.summary.total, 0)}" failures="${reports.reduce((sum, report) => sum + report.summary.failed, 0)}" time="${(reports.reduce((sum, report) => sum + report.durationMs, 0) / 1000).toFixed(3)}">`,
  );
  for (const report of reports) {
    lines.push(
      `  <testsuite name="${escapeXml(report.file)}" tests="${report.summary.total}" failures="${report.summary.failed}" time="${(report.durationMs / 1000).toFixed(3)}">`,
    );

    for (const step of report.steps) {
      lines.push(
        `    <testcase name="${escapeXml(step.name)}" classname="${escapeXml(report.file)}" time="${(step.durationMs / 1000).toFixed(3)}">`,
      );
      if (!step.passed) {
        const message = step.failures.join("; ");
        lines.push(
          `      <failure message="${escapeXml(message)}">${escapeXml(message)}</failure>`,
        );
      }
      lines.push("    </testcase>");
    }

    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Unified formatter
// ---------------------------------------------------------------------------

export function formatReport(report: ScenarioReport, format: "text" | "json" | "junit"): string {
  switch (format) {
    case "text":
      return formatReportText(report);
    case "json":
      return formatReportJson(report);
    case "junit":
      return formatReportJunit(report);
  }
}

/** One machine-readable document, regardless of the number of input files. */
export function formatReports(
  reports: readonly ScenarioReport[],
  format: "text" | "json" | "junit",
): string {
  if (format === "junit") return formatReportsJunit(reports);
  if (format === "text") return reports.map(formatReportText).join("\n\n");
  if (reports.length === 1) return JSON.stringify(reports[0]);
  const summary = reports.reduce(
    (total, report) => ({
      total: total.total + report.summary.total,
      passed: total.passed + report.summary.passed,
      failed: total.failed + report.summary.failed,
      skipped: total.skipped + report.summary.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  return JSON.stringify({ passed: reports.every((report) => report.passed), summary, reports });
}

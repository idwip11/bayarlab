import { describe, expect, it } from "vitest";
import { formatReports, type ScenarioReport } from "./report.js";

function report(file: string, passed: boolean): ScenarioReport {
  return {
    file,
    provider: "midtrans",
    passed,
    summary: { total: 1, passed: Number(passed), failed: Number(!passed), skipped: 0 },
    steps: [
      {
        index: 0,
        type: "event",
        name: "settlement",
        passed,
        failures: passed ? [] : ['expected <200> & "ok"'],
        durationMs: 1,
      },
    ],
    durationMs: 2,
  };
}

describe("multi-file reports", () => {
  const reports = [report("one<&>.yaml", true), report("two.yaml", false)];
  it("emits one JSON document with aggregate counts and compatible single-file output", () => {
    expect(JSON.parse(formatReports(reports, "json"))).toEqual({
      passed: false,
      summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
      reports,
    });
    expect(JSON.parse(formatReports([reports[0] as ScenarioReport], "json"))).toEqual(reports[0]);
  });
  it("emits one JUnit root/declaration, all suites and escaped failures", () => {
    const xml = formatReports(reports, "junit");
    expect(xml.match(/<\?xml/g)).toHaveLength(1);
    expect(xml.match(/<testsuites /g)).toHaveLength(1);
    expect(xml.match(/<testsuite /g)).toHaveLength(2);
    expect(xml.match(/<testcase /g)).toHaveLength(2);
    expect(xml).toContain('<testsuites tests="2" failures="1" time="0.004">');
    expect(xml).toContain("one&lt;&amp;&gt;.yaml");
    expect(xml).toContain("expected &lt;200&gt; &amp; &quot;ok&quot;");
    expect(xml.endsWith("</testsuites>")).toBe(true);
  });
});

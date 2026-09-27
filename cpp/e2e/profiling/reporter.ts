/** Profile reporting abstractions and formatters. */

import type { IProfileSession } from "./session.ts";

export interface IProfileReporter {
  format(session: IProfileSession): string;
  report(session: IProfileSession): void;
}

export abstract class BaseProfileReporter implements IProfileReporter {
  abstract format(session: IProfileSession): string;

  report(session: IProfileSession): void {
    const formatted = this.format(session);
    console.log(formatted);
  }
}

export class MarkdownTableProfileReporter extends BaseProfileReporter {
  override format(session: IProfileSession): string {
    const total = session.totalDurationMs();
    const primaryMetrics = session.metrics.filter((m) => !m.isSubMetric);
    const subMetrics = session.metrics.filter((m) => m.isSubMetric);

    const lines: string[] = [
      `\n### Execution Profile: ${session.name}`,
      `#### Pipeline Summary`,
      `| Phase | Step | Duration (ms) | % of Total | Details |`,
      `| :--- | :--- | :---: | :---: | :--- |`,
    ];

    for (const metric of primaryMetrics) {
      const pct = total > 0 ? ((metric.durationMs / total) * 100).toFixed(1) : "0.0";
      const detailsStr = metric.details
        ? Object.entries(metric.details)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : "-";
      lines.push(
        `| ${metric.phase} | ${metric.name} | ${metric.durationMs.toFixed(2)} ms | ${pct}% | ${detailsStr} |`,
      );
    }

    lines.push(`| **Total Test Pipeline** | | **${total.toFixed(2)} ms** | **100.0%** | |`);

    if (subMetrics.length > 0) {
      lines.push(
        `\n#### Detailed Sub-step Breakdown & Artifacts`,
        `| Phase | Sub-step | Duration (ms) | Metadata / Artifacts |`,
        `| :--- | :--- | :---: | :--- |`,
      );

      for (const metric of subMetrics) {
        const detailsStr = metric.details
          ? Object.entries(metric.details)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")
          : "-";
        const durationStr = metric.durationMs > 0 ? `${metric.durationMs.toFixed(2)} ms` : "-";
        lines.push(`| ${metric.phase} | ${metric.name} | ${durationStr} | ${detailsStr} |`);
      }
    }

    return lines.join("\n");
  }
}

import {
  CHECK_STATUS,
  CHECK_TABLE_HEADERS,
  CHECK_VERDICT,
  INCONCLUSIVE_HINT,
  TABLE_COLUMN_GAP,
  VERDICT_LABEL,
} from './lib.constants';
import type { ICheckRow } from './lib.interfaces';
import type { CheckVerdict } from './lib.type';

function columnWidths(headers: string[], rows: string[][]): number[] {
  return headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = columnWidths(headers, rows);

  console.log(
    headers
      .map((header, index) => header.padEnd(widths[index] ?? header.length))
      .join(TABLE_COLUMN_GAP),
  );

  for (const row of rows) {
    console.log(
      row
        .map((cell, index) => (cell ?? '').padEnd(widths[index] ?? cell.length))
        .join(TABLE_COLUMN_GAP),
    );
  }
}

// печатает сводную таблицу PASS/FAIL/SKIP и вердикт прогона. SKIP — не успех: строка
// пропущенной проверки означает, что инвариант не проверялся, поэтому вердикт становится
// INCONCLUSIVE, а вызывающий инструмент выставляет по нему EXIT_CODE.INCONCLUSIVE
export function printCheckTable(rows: ICheckRow[]): CheckVerdict {
  printTable(
    CHECK_TABLE_HEADERS,
    rows.map((row) => [row.name, row.status, row.detail]),
  );

  const passed = rows.filter((row) => row.status === CHECK_STATUS.PASS).length;
  const failed = rows.filter((row) => row.status === CHECK_STATUS.FAIL).length;
  const skipped = rows.filter((row) => row.status === CHECK_STATUS.SKIP).length;

  console.log(`PASS ${passed} / FAIL ${failed} / SKIP ${skipped}`);

  if (failed > 0) {
    console.log(`${VERDICT_LABEL}: ${CHECK_VERDICT.FAIL}`);

    return CHECK_VERDICT.FAIL;
  }

  if (skipped > 0) {
    console.log(`${VERDICT_LABEL}: ${CHECK_VERDICT.INCONCLUSIVE} — ${INCONCLUSIVE_HINT}`);

    return CHECK_VERDICT.INCONCLUSIVE;
  }

  console.log(`${VERDICT_LABEL}: ${CHECK_VERDICT.PASS}`);

  return CHECK_VERDICT.PASS;
}

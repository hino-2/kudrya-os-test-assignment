import { CHECK_STATUS, CHECK_TABLE_HEADERS, TABLE_COLUMN_GAP } from './lib.constants';
import type { ICheckRow } from './lib.interfaces';

function columnWidths(headers: string[], rows: string[][]): number[] {
  return headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)));
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = columnWidths(headers, rows);

  console.log(headers.map((header, index) => header.padEnd(widths[index] ?? header.length)).join(TABLE_COLUMN_GAP));

  for (const row of rows) {
    console.log(row.map((cell, index) => (cell ?? '').padEnd(widths[index] ?? cell.length)).join(TABLE_COLUMN_GAP));
  }
}

// печатает сводную таблицу PASS/FAIL/SKIP и возвращает true, только если ни одной строки FAIL —
// именно это булево значение задаёт process.exitCode у webhook.ts/race.ts
export function printCheckTable(rows: ICheckRow[]): boolean {
  printTable(
    CHECK_TABLE_HEADERS,
    rows.map((row) => [row.name, row.status, row.detail]),
  );

  const passed = rows.filter((row) => row.status === CHECK_STATUS.PASS).length;
  const failed = rows.filter((row) => row.status === CHECK_STATUS.FAIL).length;
  const skipped = rows.filter((row) => row.status === CHECK_STATUS.SKIP).length;

  console.log(`PASS ${passed} / FAIL ${failed} / SKIP ${skipped}`);

  return failed === 0;
}

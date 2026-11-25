// Records of a CSV file as Excel and Google Sheets write it: comma or
// semicolon (whichever the first record uses), double-quoted fields with ""
// for a quote, a leading BOM. Blank records are dropped. Throws on broken
// quoting.
export function csvRows(text) {
  const input = text.replace(/^\uFEFF/, "").trimEnd();
  const separator =
    input.match(/^(?:"(?:[^"]|"")*"|[^",;\r\n])*([,;])/)?.[1] ?? ",";
  const field = new RegExp(
    `("(?:[^"]|"")*"|[^"${separator}\\r\\n]*)([${separator}]|\\r?\\n|$)`,
    "y",
  );
  const rows = [];
  let row = [];
  let offset = 0;
  while (offset < input.length || row.length) {
    field.lastIndex = offset;
    const match = field.exec(input);
    if (!match)
      throw new Error(`Invalid CSV quoting in row ${rows.length + 1}.`);
    const [, value, after] = match;
    row.push(
      value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value,
    );
    offset = field.lastIndex;
    if (after === separator) continue;
    if (row.some((cell) => cell.trim())) rows.push(row);
    row = [];
  }
  return rows;
}

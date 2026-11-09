export function richTextSummary(html = "") {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,
      (entity, name) => {
        if (!name.startsWith("#")) return named[name.toLowerCase()];
        const number =
          name[1].toLowerCase() === "x"
            ? parseInt(name.slice(2), 16)
            : Number(name.slice(1));
        return number > 0 &&
          number <= 0x10ffff &&
          !(number >= 0xd800 && number <= 0xdfff)
          ? String.fromCodePoint(number)
          : "�";
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}

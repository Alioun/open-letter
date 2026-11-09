// Version 1 stored a rendered FAQ. Version 2 stores its ordered questions.
export function migrateFaq(block = {}) {
  if (Array.isArray(block.items)) return block;
  const html = block.html || "";
  const introductionHtml =
    html.match(/<aside\b[^>]*>([\s\S]*?)<\/aside>/i)?.[1] || "";
  const items = [
    ...html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi),
  ].map((match, i) => {
    const question = match[1].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    let answerHtml = match[1]
      .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, "")
      .trim();
    if (/^<div\b[^>]*class="faq-answer"/.test(answerHtml))
      answerHtml = answerHtml
        .replace(/^<div[^>]*>/, "")
        .replace(/<\/div>$/, "");
    return {
      id: `question-${i + 1}`,
      questionHtml: question?.[1] || "",
      answerHtml,
    };
  });
  return { introductionHtml, items };
}

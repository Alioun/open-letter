import { defaultLayout } from "../config/publication.js";

export function Section({ block, config, body }) {
  const p = block.props;
  const text = config.publication?.blocks?.[p.id] || {};
  const style = {
    paddingBlock: p.spacing,
    textAlign: p.align,
    background: p.background || undefined,
    color: p.color || undefined,
    fontFamily: `var(--font-${p.font})`,
    fontSize: p.fontSize,
    "--section-background": p.background || undefined,
    "--section-color": p.color || undefined,
    "--section-font": `var(--font-${p.font})`,
    "--section-font-size": `${p.fontSize}px`,
    "--section-width":
      p.width === "narrow" ? "760px" : p.width === "wide" ? "1200px" : "100%",
  };
  let content = body;
  if (block.type === "Text")
    content = (
      <div
        className="section-inner"
        dangerouslySetInnerHTML={{ __html: text.html || "" }}
      />
    );
  if (block.type === "Image")
    content = (
      <div className="section-inner">
        {text.src && (
          <img
            src={text.src}
            alt={text.alt || ""}
            style={{ maxWidth: "100%" }}
          />
        )}
      </div>
    );
  if (block.type === "CallToAction")
    content = (
      <div className="section-inner">
        <h2>{text.title}</h2>
        <p>{text.text}</p>
        <a className="scrollcta" href={text.href || "#unterzeichnen"}>
          {text.label || config.hero.ctaPrimary}
        </a>
      </div>
    );
  return (
    <div
      data-section={p.id}
      data-arrangement={p.arrangement}
      data-background={p.background ? "custom" : undefined}
      data-color={p.color ? "custom" : undefined}
      data-typography={
        p.font !== "body" || p.fontSize !== 18 ? "custom" : undefined
      }
      className={`published-section published-section--${block.type.toLowerCase()}`}
      style={style}
    >
      {content}
    </div>
  );
}

export function layoutFor(config) {
  return config.publication?.layout || defaultLayout(config);
}

export function RichLetter({ config, fallback, total }) {
  const html = config.publication?.blocks?.brief?.html;
  return html ? (
    <article
      className="brief-paper"
      dangerouslySetInnerHTML={{
        __html: html.replaceAll(
          "{{total}}",
          Number(total).toLocaleString(config.brand.locale),
        ),
      }}
    />
  ) : (
    fallback
  );
}

export function RichFaq({ config, fallback }) {
  const faq = config.publication?.blocks?.faq;
  return faq?.items ? (
    <div className="faq-wrap">
      <aside
        className="faq-aside"
        dangerouslySetInnerHTML={{ __html: faq.introductionHtml }}
      />
      <div className="faq-list">
        {faq.items.map((item) => (
          <details className="faq-item" key={item.id}>
            <summary
              className="faq-q"
              dangerouslySetInnerHTML={{ __html: item.questionHtml }}
            />
            <div
              className="faq-answer"
              dangerouslySetInnerHTML={{ __html: item.answerHtml }}
            />
          </details>
        ))}
      </div>
    </div>
  ) : (
    fallback
  );
}

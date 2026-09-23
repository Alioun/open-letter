// Example rich page content (generic open letter). Mirrors the exports of
// config/letters/gehaltsdeckel/content.jsx.

export function LetterArticle({ total }) {
  return (
    <article className="brief-paper" aria-labelledby="brief-heading">
      <h2 id="brief-heading">An open letter</h2>
      <p className="anrede">To whom it may concern,</p>

      <p className="lead">
        This is an example open letter. Replace this content with your own
        campaign text in <code>config/letters/&lt;your-letter&gt;/content.jsx</code>.
      </p>

      <p>
        Everything else on this page (the title, colours, hero, sign form,
        emails and feature flags) is configured in the sibling{" "}
        <code>index.js</code> file.
      </p>

      <blockquote className="pullquote">
        „One clear demand, stated plainly, carries further than ten."
      </blockquote>

      <p>
        Add as many paragraphs as you need. The layout, typography and theme are
        provided by the template.
      </p>

      <p className="gruss">With thanks</p>

      <p className="signers-line">
        and {total.toLocaleString("en-GB")} signatories
      </p>
    </article>
  );
}

export function FaqContent() {
  return (
    <div className="faq-wrap">
      <aside className="faq-aside">
        <span className="num">04 / Questions &amp; Answers</span>
        <h2>
          Frequently
          <br />
          asked.
        </h2>
        <div className="faq-intro">
          <p>Replace these questions with your own.</p>
        </div>
      </aside>

      <div className="faq-list">
        <details className="faq-item">
          <summary className="faq-q">What is this?</summary>
          <div className="faq-answer">
            <p>An example open letter built on a reusable template.</p>
          </div>
        </details>
        <details className="faq-item">
          <summary className="faq-q">How do I sign?</summary>
          <div className="faq-answer">
            <p>Fill in the form and confirm via the link we email you.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

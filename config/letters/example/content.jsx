// Example rich page content (generic open letter): the LetterArticle and
// FaqContent exports every letter's content.jsx provides.

export function LetterArticle({ total }) {
  return (
    <article className="brief-paper" aria-labelledby="brief-heading">
      <h2 id="brief-heading">An open letter</h2>
      <p className="anrede">To whom it may concern,</p>

      <p className="lead">
        Change begins when people come together around a clear demand. We ask
        decision-makers to listen, act and report openly on their progress.
      </p>

      <p>
        Our signatures show that this issue matters to people across our
        community. Each voice strengthens the call for a practical response.
      </p>

      <blockquote className="pullquote">
        „One clear demand, stated plainly, carries further than ten."
      </blockquote>

      <p>
        Please add your name and share this letter with others who support its
        aim. Together, we can turn shared concern into lasting change.
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
          <p>Learn how to take part and what happens after you sign.</p>
        </div>
      </aside>

      <div className="faq-list">
        <details className="faq-item">
          <summary className="faq-q">What is this?</summary>
          <div className="faq-answer">
            <p>A shared call for action, supported by everyone who signs.</p>
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

import { Button } from "@base-ui/react/button";

export default function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="admin-pagination">
      <Button
        type="button"
        className="admin-button admin-button--small"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        Zurück
      </Button>
      <span className="admin-muted">
        Seite {page + 1} / {pages}
      </span>
      <Button
        type="button"
        className="admin-button admin-button--small"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        Weiter
      </Button>
    </div>
  );
}

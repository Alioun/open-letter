import { useCallback, useRef, useState } from "react";

const TOKEN_KEY = "open_letter_admin_token";

export function useAdminSession() {
  const [session, setSession] = useState(() => {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    return { token, status: token ? "active" : "anonymous" };
  });
  const current = useRef(session);
  const update = useCallback((next) => {
    current.current = next;
    setSession(next);
  }, []);
  const signIn = useCallback(
    (token) => {
      localStorage.setItem(TOKEN_KEY, token);
      update({ token, status: "active" });
    },
    [update],
  );
  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    update({ token: "", status: "anonymous" });
  }, [update]);
  const api = useCallback(
    async (path, options = {}) => {
      const requested = current.current;
      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requested.token}`,
          ...(options.headers || {}),
        },
      });
      if (response.status === 401 && current.current === requested) {
        localStorage.removeItem(TOKEN_KEY);
        update({ ...requested, status: "expired" });
      }
      if (response.status === 401)
        return Response.json(
          {
            error:
              "Diese Aktion wurde wegen einer abgelaufenen Sitzung nicht bestätigt. Deine Eingaben bleiben erhalten. Prüfe nach der erneuten Anmeldung den aktuellen Stand, bevor du die Aktion wiederholst.",
          },
          { status: 401 },
        );
      return response;
    },
    [update],
  );
  return { ...session, api, signIn, signOut };
}

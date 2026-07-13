import { useEffect, useState } from "react";
import { Button, PasswordInput, Tag, TextInput } from "@carbon/react";
import { current, isAdmin, signIn, signOut, subscribe } from "../auth";

/**
 * The account control, top-right of the header.
 *
 * It shows who you are, whether you are elevated, and lets you sign out. Signing in here signs you in
 * everywhere — the identity lives under the same localStorage key the other front ends read, so the
 * three apps are one session, not three.
 *
 * The code is behind a reveal rather than printed. Not because seeing it is dangerous — anyone at
 * this keyboard already holds the session — but because people screen-share dashboards, and a
 * credential parked permanently in the corner of a demo is a credential that leaves the room.
 */
export default function Account() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => subscribe(() => force((n) => n + 1)), []);

  const id = current();

  const doSignIn = async () => {
    setErr(null);
    try {
      await signIn(username, code);
      setOpen(false);
      setCode("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not sign in");
    }
  };

  return (
    <div className="acct">
      <button className="acct-chip" onClick={() => { setOpen((o) => !o); setRevealed(false); }}>
        <span className={`acct-dot ${id?.mode ?? "none"}`} />
        {id?.mode === "user" ? id.username : "Sign in"}
        {isAdmin() && <Tag type="blue" size="sm">admin</Tag>}
      </button>

      {open && (
        <div className="acct-panel">
          {id?.mode === "user" ? (
            <>
              <div className="acct-row">
                <span>Username</span>
                <code>{id.username}</code>
              </div>
              <div className="acct-row">
                <span>Code</span>
                {revealed ? (
                  <code className="acct-code">{id.code ?? "—"}</code>
                ) : (
                  <button className="acct-link" onClick={() => setRevealed(true)}>Show</button>
                )}
              </div>
              <p className="acct-note">
                {isAdmin()
                  ? "You can change the registry. Everyone else sees it read-only."
                  : "Reads only. Changing anything here needs an admin."}
              </p>
              <Button kind="ghost" size="sm" onClick={() => { signOut(); location.reload(); }}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <TextInput
                id="acct-user"
                labelText="Username"
                size="sm"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              {/* PasswordInput, not TextInput: this is a credential, and it should not be sitting in
                  plain text on a screen that gets shared. */}
              <PasswordInput
                id="acct-code"
                labelText="Code"
                size="sm"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {err && <p className="acct-err">{err}</p>}
              <Button size="sm" onClick={() => void doSignIn()} style={{ marginTop: "0.5rem" }}>
                Sign in
              </Button>
              <p className="acct-note">
                No account? Create one on the quiz or the home page — it is the same identity
                everywhere.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

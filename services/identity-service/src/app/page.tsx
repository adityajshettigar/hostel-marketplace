// Identity-service landing page (API-only service: page is required by the
// framework for the / route, but no UI is rendered yet).

export default function Page() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Identity-Service</h1>
      <p>Phase 2 scaffold: registration, login, 2FA, session management (REST API only).</p>
    </main>
  );
}

// Alias module so "@/lib/auth/auth_context" resolves to the real auth-context
// implementation below (the module is authored as auth-context.tsx; this file
// just provides the alternate import path the register page now uses).
export { AuthProvider, useAuth, RequireAuth } from "./auth-context";

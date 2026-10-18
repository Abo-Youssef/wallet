// Cloudflare handles this reserved path before the Worker. Navigate at the top
// level so Access, not JavaScript, clears its HttpOnly authorization cookie.
export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";
export const LOGOUT_SIGNAL_KEY = "wallet-session-logout-v1";
export const navigateToAccessLogout = () => window.location.replace(ACCESS_LOGOUT_PATH);

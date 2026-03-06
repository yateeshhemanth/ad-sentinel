import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authApi, settingsApi } from "../utils/api";
import { resolveAssetUrl } from "../utils/assetUrl";

const AuthContext = createContext(null);

// Apply branding CSS variables to document root so every component picks them up
function applyBranding({ primaryColor, portalTitle, portalSubtitle, logoUrl }) {
  if (primaryColor) {
    document.documentElement.style.setProperty("--ads-accent", primaryColor);
    // Derive a dimmed version for backgrounds/borders
    document.documentElement.style.setProperty("--ads-accent-gl", primaryColor + "22");
  }
  if (portalTitle) document.title = portalTitle;
}

export const AuthProvider = ({ children }) => {
  const [user,          setUser]          = useState(null);
  const [logoUrl,       setLogoUrl]       = useState(null);
  const [portalTitle,   setPortalTitle]   = useState("ADSentinel");
  const [portalSubtitle,setPortalSubtitle]= useState("Enterprise Active Directory Security");
  const [primaryColor,  setPrimaryColor]  = useState("#22c55e");
  const [loading,       setLoading]       = useState(true);

  const applyAndStore = useCallback((data) => {
    setLogoUrl(resolveAssetUrl(data.logoUrl) || null);
    setPortalTitle(data.portalTitle || "ADSentinel");
    setPortalSubtitle(data.portalSubtitle || "Enterprise Active Directory Security");
    setPrimaryColor(data.primaryColor || "#22c55e");
    applyBranding(data);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("ads_token");
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then((data) => { setUser(data); applyAndStore(data); })
      .catch(() => {
        localStorage.removeItem("ads_token");
        localStorage.removeItem("ads_user");
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const login = useCallback(async (email, password) => {
    const data = await authApi.login({ email, password });
    localStorage.setItem("ads_token", data.token);
    localStorage.setItem("ads_user",  JSON.stringify(data.user));
    setUser(data.user);
    // Fetch full branding after login
    const me = await authApi.me();
    applyAndStore(me);
    return data.user;
  }, [applyAndStore]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch (_) {}
    localStorage.removeItem("ads_token");
    localStorage.removeItem("ads_user");
    setUser(null);
    setLogoUrl(null);
  }, []);

  // Called after logo upload/remove
  const refreshLogo = useCallback((url) => setLogoUrl(resolveAssetUrl(url) || null), []);

  // Called after branding save in Settings — re-fetches all settings and re-applies
  const refreshBranding = useCallback(async () => {
    try {
      const s = await settingsApi.get();
      const branding = {
        logoUrl:        resolveAssetUrl(s.logo_url) || logoUrl,
        portalTitle:    s.portal_title    || "ADSentinel",
        portalSubtitle: s.portal_subtitle || "Enterprise Active Directory Security",
        primaryColor:   s.primary_color   || "#22c55e",
      };
      applyAndStore(branding);
    } catch {}
  }, [applyAndStore, logoUrl]);

  return (
    <AuthContext.Provider value={{
      user, logoUrl, portalTitle, portalSubtitle, primaryColor,
      loading, login, logout, refreshLogo, refreshBranding,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};

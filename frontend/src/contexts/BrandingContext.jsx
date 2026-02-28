import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../api';
import { useTheme } from './ThemeContext';

export const BRANDING_DEFAULTS = {
  app_name: 'SMTPFlow',
  logo_url: '',
  primary_color: '#6366f1',
  secondary_color: '#4f46e5',
  support_email: '',
  footer_text: '',
  spf_record: '',
  default_theme: 'auto',
};

const BrandingContext = createContext({ branding: BRANDING_DEFAULTS, setBranding: () => {} });

export function applyBrandingCssVars(b) {
  const el = document.documentElement;
  el.style.setProperty('--color-primary', b.primary_color || BRANDING_DEFAULTS.primary_color);
  el.style.setProperty('--color-secondary', b.secondary_color || BRANDING_DEFAULTS.secondary_color);
  if (b.app_name) document.title = b.app_name;
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(BRANDING_DEFAULTS);
  const { setDark } = useTheme();

  useEffect(() => {
    api.get('/branding')
      .then(res => {
        const b = { ...BRANDING_DEFAULTS, ...res.data };
        setBranding(b);
        applyBrandingCssVars(b);
        // Applica tema di default solo se l'utente non ha una preferenza salvata
        if (!localStorage.getItem('theme') && b.default_theme && b.default_theme !== 'auto') {
          setDark(b.default_theme === 'dark');
        }
      })
      .catch(() => applyBrandingCssVars(BRANDING_DEFAULTS));
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, setBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);

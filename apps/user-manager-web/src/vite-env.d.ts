/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_DOMAIN?: string;
  readonly VITE_WEBSITE_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

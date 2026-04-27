// Type declarations for firebase-admin external module
// This module is loaded dynamically at runtime and is listed as an external in esbuild.mjs

declare module 'firebase-admin/app' {
  export function initializeApp(options?: any): any;
  export function cert(serviceAccount: any): any;
  export function applicationDefault(): any;
  export function deleteApp(app: any): Promise<void>;
}

declare module 'firebase-admin/firestore' {
  export function getFirestore(app?: any, databaseId?: string): any;
}
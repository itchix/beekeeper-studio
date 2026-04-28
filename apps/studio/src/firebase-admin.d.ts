// Type declarations for firebase-admin external module
// This module is loaded dynamically at runtime and is listed as an external in esbuild.mjs

declare module "firebase-admin/app" {
  export function initializeApp(options?: any, name?: string): any;
  export function cert(serviceAccount: any): any;
  export function applicationDefault(): any;
  export function deleteApp(app: any): Promise<void>;
  export const SDK_VERSION: string;
}

declare module "firebase-admin/firestore" {
  export function getFirestore(app?: any, databaseId?: string): any;

  export class Timestamp {
    readonly seconds: number;
    readonly nanoseconds: number;
    static fromDate(date: Date): Timestamp;
    static fromMillis(milliseconds: number): Timestamp;
    toDate(): Date;
    toMillis(): number;
    isEqual(other: Timestamp): boolean;
  }

  export class GeoPoint {
    readonly latitude: number;
    readonly longitude: number;
    constructor(latitude: number, longitude: number);
    isEqual(other: GeoPoint): boolean;
  }
}

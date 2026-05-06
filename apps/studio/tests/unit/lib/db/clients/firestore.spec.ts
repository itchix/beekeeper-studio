jest.mock("@bksLogger", () => ({
  __esModule: true,
  default: {
    scope: () => ({
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock("firebase-admin/app", () => ({
  __esModule: true,
  initializeApp: jest.fn(),
  cert: jest.fn((value) => value),
  applicationDefault: jest.fn(() => ({ type: "application-default" })),
  deleteApp: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("firebase-admin/auth", () => ({
  __esModule: true,
  getAuth: jest.fn(),
}));

jest.mock("firebase-admin/firestore", () => ({
  __esModule: true,
  getFirestore: jest.fn(),
}));

jest.mock("@google-cloud/firestore", () => ({
  __esModule: true,
  Firestore: jest.fn(),
}));

import { FirestoreClient } from "@/lib/db/clients/firestore";
import { IDbConnectionServer } from "@/lib/db/backendTypes";
import { IDbConnectionDatabase, FirestoreAuthType } from "@/lib/db/types";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { Firestore as GoogleCloudFirestore } from "@google-cloud/firestore";

function makeServer(
  overrides: Partial<IDbConnectionServer["config"]> = {}
): IDbConnectionServer {
  return {
    db: {},
    config: {
      client: "firestore",
      host: null,
      port: null,
      user: null,
      password: null,
      readOnlyMode: false,
      osUser: "testuser",
      ssh: null,
      sslCaFile: null,
      sslCertFile: null,
      sslKeyFile: null,
      sslRejectUnauthorized: false,
      ssl: false,
      domain: null,
      socketPath: null,
      socketPathEnabled: false,
      firestoreOptions: {
        authType: FirestoreAuthType.ServiceAccount,
      },
      ...overrides,
    },
  } as IDbConnectionServer;
}

function makeDatabase(): IDbConnectionDatabase {
  return {
    database: "(default)",
    connected: false,
    connecting: false,
    namespace: "",
  };
}

describe("FirestoreClient unit tests", () => {
  let client: FirestoreClient;

  beforeEach(() => {
    client = new FirestoreClient(makeServer(), makeDatabase());
    jest.clearAllMocks();
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  afterEach(() => {
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  it("scopes emulator hosts to the wrapped operation and restores previous values", async () => {
    const emulatorClient = new FirestoreClient(
      makeServer({
        firestoreOptions: {
          authType: FirestoreAuthType.Emulator,
          emulatorHost: "127.0.0.1:8088",
        },
      }),
      makeDatabase()
    );

    process.env.FIREBASE_AUTH_EMULATOR_HOST = "existing-auth-host:9099";
    process.env.FIRESTORE_EMULATOR_HOST = "existing-firestore-host:8080";

    const observedHosts = await (emulatorClient as any).withEmulatorEnv(
      { auth: true, firestore: true },
      async () => ({
        auth: process.env.FIREBASE_AUTH_EMULATOR_HOST,
        firestore: process.env.FIRESTORE_EMULATOR_HOST,
      })
    );

    expect(observedHosts).toEqual({
      auth: "127.0.0.1:9099",
      firestore: "127.0.0.1:8088",
    });
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe(
      "existing-auth-host:9099"
    );
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe(
      "existing-firestore-host:8080"
    );
  });

  it("throws a clear error when auth methods are used without an auth client", async () => {
    await expect(client.listAuthUsers()).rejects.toThrow(
      "Firebase Auth is not available for this connection. Check emulator settings or IAM permissions."
    );
  });

  it("uses the direct Firestore client for emulator connections", async () => {
    const emulatorClient = new FirestoreClient(
      makeServer({
        firestoreOptions: {
          authType: FirestoreAuthType.Emulator,
          emulatorHost: "127.0.0.1:8088",
          projectId: "bks-dev",
        },
      }),
      makeDatabase()
    );

    const listCollections = jest.fn().mockResolvedValue([]);

    (initializeApp as jest.Mock).mockReturnValue({ name: "firebase-app" });
    (getAuth as jest.Mock).mockReturnValue({});
    (GoogleCloudFirestore as unknown as jest.Mock).mockImplementation(() => ({
      listCollections,
      terminate: jest.fn().mockResolvedValue(undefined),
    }));

    await emulatorClient.connect();

    expect(GoogleCloudFirestore).toHaveBeenCalledWith({
      projectId: "bks-dev",
      databaseId: "(default)",
      host: "127.0.0.1:8088",
      ssl: false,
    });
    expect(getFirestore).not.toHaveBeenCalled();
    expect(listCollections).toHaveBeenCalled();
  });

  it("preserves compatible user orderBy clauses when paginating with an inequality filter", async () => {
    const query = {
      where: jest.fn(),
      orderBy: jest.fn(),
      startAfter: jest.fn(),
      offset: jest.fn(),
      limit: jest.fn(),
      get: jest.fn(),
    };

    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.startAfter.mockReturnValue(query);
    query.offset.mockReturnValue(query);
    query.limit.mockReturnValue(query);

    const cursorSnapshot = {
      exists: true,
      id: "doc-1",
      data: () => ({ score: 1 }),
    };

    const collectionRef = {
      ...query,
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue(cursorSnapshot),
      }),
    };

    query.get.mockResolvedValue({
      docs: [
        {
          id: "doc-2",
          data: () => ({ score: 2, name: "beta" }),
        },
      ],
    });
    (client as any).firestoreDb = {
      collection: jest.fn().mockReturnValue(collectionRef),
    };

    await client.selectTop(
      "users",
      JSON.stringify({ __name__: "doc-1" }),
      25,
      [{ field: "name", dir: "DESC" }],
      "score >= 1"
    );

    expect(query.orderBy.mock.calls).toEqual([
      ["score", "asc"],
      ["name", "desc"],
      ["__name__", "asc"],
    ]);
    expect(query.startAfter).toHaveBeenCalledWith(cursorSnapshot);
    expect(query.offset).not.toHaveBeenCalled();
  });

  it("keeps the user direction when ordering by the inequality field", async () => {
    const query = {
      where: jest.fn(),
      orderBy: jest.fn(),
      startAfter: jest.fn(),
      offset: jest.fn(),
      limit: jest.fn(),
      get: jest.fn(),
    };

    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.startAfter.mockReturnValue(query);
    query.offset.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.get.mockResolvedValue({ docs: [] });

    (client as any).firestoreDb = {
      collection: jest.fn().mockReturnValue({
        ...query,
        doc: jest.fn(),
      }),
    };

    await client.selectTop(
      "users",
      null,
      25,
      [{ field: "score", dir: "DESC" }],
      "score >= 1"
    );

    expect(query.orderBy.mock.calls).toEqual([
      ["score", "desc"],
      ["__name__", "asc"],
    ]);
  });

  it("clears stale type cache entries for the current table before rebuilding columns", async () => {
    (client as any).timestampColumns.add("users.createdAt");
    (client as any).timestampColumns.add("orders.createdAt");
    (client as any).geopointColumns.add("users.location");
    (client as any).referenceColumns.add("users.manager");
    (client as any).firestoreDb = {
      collection: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            empty: true,
          }),
        }),
      }),
    };

    await client.listTableColumns("users");

    expect((client as any).timestampColumns.has("users.createdAt")).toBe(false);
    expect((client as any).timestampColumns.has("orders.createdAt")).toBe(true);
    expect((client as any).geopointColumns.has("users.location")).toBe(false);
    expect((client as any).referenceColumns.has("users.manager")).toBe(false);
  });

  it("does not coerce date-like or geopoint-like strings on generic inserts", () => {
    const convertValueForInsert = (client as any).convertValueForInsert.bind(
      client
    );

    expect(convertValueForInsert("2024-01-01 12:00:00", null, null)).toBe(
      "2024-01-01 12:00:00"
    );
    expect(convertValueForInsert("1.5, 2.5", null, null)).toBe("1.5, 2.5");
  });
});

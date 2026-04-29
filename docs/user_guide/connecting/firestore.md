---
title: Google Firestore
summary: "Connect to Google Cloud Firestore with Beekeeper Studio"
icon: simple/googlecloud
description: "Use Beekeeper Studio to browse, query, and edit Firestore collections and documents"
---

# Firestore Support

!!! warning "Beta Feature"
    Firestore support is in beta. Report issues on [GitHub](https://github.com/beekeeper-studio/beekeeper-studio/issues).

## Prerequisites

Connecting to Firestore requires a Google Cloud service account with appropriate permissions:

1. Go to the [Firebase Console &rarr; Service Accounts](https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk)
2. Create a service account or select an existing one
3. Generate and download a new private key JSON file

## Minimum IAM Role

**Cloud Datastore User**

This role provides read/write access to Firestore documents. For admin operations (creating indexes, managing security rules), use **Cloud Datastore Owner** or **Firebase Admin**.

## Connecting from Beekeeper Studio

### Authentication Methods

Beekeeper Studio supports two authentication methods for Firestore:

1. **Service Account Key** — paste the JSON contents directly, or provide a file path to the downloaded JSON key
2. **Application Default Credentials** — uses `gcloud auth application-default login` if already configured on your machine

### Connection Settings

| Field | Required | Description |
|-------|----------|-------------|
| Authentication Method | Yes | Service Account Key or ADC |
| Service Account JSON | No\* | Paste the contents of your service account JSON key |
| Service Account File Path | No\* | Absolute path to your `.json` key file |
| Project ID | No | Auto-detected from service account. Override if needed |
| Database ID | No | Defaults to `(default)`. Specify a named database if configured |

\*Either JSON or file path is required when using Service Account Key authentication.

!!! tip "Project ID"
    The Project ID is automatically extracted from your service account JSON. Only override it if you need to connect to a different project.

## Querying Firestore

Firestore uses a code-based query syntax, not SQL. In the query editor, use the Firebase Admin SDK syntax:

```js
db.collection('users').get()

db.collection('users').where('age', '>', 18).orderBy('name').limit(10).get()

db.collectionGroup('posts').where('published', '==', true).get()
```

You can also run:

- `list collections` — show all collections in the database
- `"collectionName"` — browse a single collection by name

## Supported Features

- Browse collections and documents
- View and edit document data
- Sort and filter in the data view
- Create and drop collections
- Duplicate collections
- Inline cell editing
- Query autocomplete for collections and fields
- Cursor-based pagination

### Firestore-Specific Types

Firestore special types are displayed in a readable format:

| Type | Display Format |
|------|---------------|
| Timestamp | `YYYY-MM-DD HH:mm:ss.SSS` |
| GeoPoint | `latitude, longitude` |
| DocumentReference | Collection path (e.g. `users/abc123`) |
| Array | JSON stringified |
| Map | Flattened with dot notation (e.g. `address.city`) |

## Limitations

The following features are not available for Firestore connections:

- SQL queries (use the JS-like SDK syntax instead)
- Table structure editing (Firestore is schemaless)
- Index management (managed via Google Cloud Console)
- SSH tunneling
- Data export and import
- Server-side backup and restore
- Triggers and stored routines

## Authentication Management

Firestore connections include a built-in **Authentication** tab to manage Firebase Auth users:

- View, search, and paginate through users
- Create new users with email/password
- Edit user details (display name, disabled status)
- Delete users

Access the Authentication tab from the sidebar when connected to a Firestore database.

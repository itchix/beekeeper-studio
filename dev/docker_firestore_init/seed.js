#!/usr/bin/env node
// Seeds the Firestore and Auth emulators with sakila-style sample data.
// Connects via REST APIs so no SDK credentials are needed.

const FIRESTORE_BASE = 'http://localhost:8080/v1/projects/bks-dev/databases/(default)/documents';
const AUTH_BATCH_CREATE = 'http://localhost:9099/identitytoolkit.googleapis.com/v1/projects/bks-dev/accounts:batchCreate';

async function post(collection, docId, fields) {
  const url = `${FIRESTORE_BASE}/${collection}/${docId}`;
  const body = JSON.stringify({ fields });
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to write ${collection}/${docId}: ${res.status} ${text}`);
  }
}

// batchCreate accepts pre-hashed passwords. For the emulator we pass a raw
// password encoded as base64 with hashAlgorithm PLAIN_TEXT.
function toBase64(str) {
  return Buffer.from(str).toString('base64');
}

async function clearAuthUsers() {
  const res = await fetch('http://localhost:9099/emulator/v1/projects/bks-dev/accounts', { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to clear auth users: ${res.status} ${text}`);
  }
}

async function createAuthUsers(users) {
  const payload = {
    users: users.map(({ localId, email, password, displayName, emailVerified = false, disabled = false }) => ({
      localId,
      email,
      displayName,
      emailVerified,
      disabled,
      passwordHash: toBase64(password),
      salt: toBase64('salt'),
    })),
    hashAlgorithm: 'HMAC_SHA256',
    signerKey: toBase64('fake-key'),
    saltSeparator: '',
  };
  const res = await fetch(AUTH_BATCH_CREATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer owner' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to batch create auth users: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (data.error && data.error.length) {
    throw new Error(`Auth batch create errors: ${JSON.stringify(data.error)}`);
  }
  users.forEach(u => console.log(`  Auth user created: ${u.email} (uid: ${u.localId})`));
}

function str(v) { return { stringValue: v }; }
function num(v) { return { integerValue: String(v) }; }
function dbl(v) { return { doubleValue: v }; }
function bool(v) { return { booleanValue: v }; }
function ts(v) { return { timestampValue: v }; }
function arr(...vals) { return { arrayValue: { values: vals } }; }
function map(fields) { return { mapValue: { fields } }; }

async function seed() {
  // Collection: films
  await post('films', 'film_1', {
    title: str('ACADEMY DINOSAUR'),
    description: str('A Epic Drama of a Feminist And a Mad Scientist who must Battle a Teacher in The Canadian Rockies'),
    release_year: num(2006),
    language: str('English'),
    rental_duration: num(6),
    rental_rate: dbl(0.99),
    length: num(86),
    replacement_cost: dbl(20.99),
    rating: str('PG'),
    special_features: arr(str('Deleted Scenes'), str('Behind the Scenes')),
    category: str('Documentary'),
  });

  await post('films', 'film_2', {
    title: str('ACE GOLDFINGER'),
    description: str('A Astounding Epistle of a Database Administrator And a Explorer who must Find a Car in Ancient China'),
    release_year: num(2006),
    language: str('English'),
    rental_duration: num(3),
    rental_rate: dbl(4.99),
    length: num(48),
    replacement_cost: dbl(12.99),
    rating: str('G'),
    special_features: arr(str('Trailers'), str('Deleted Scenes')),
    category: str('Horror'),
  });

  await post('films', 'film_3', {
    title: str('ADAPTATION HOLES'),
    description: str('A Astounding Reflection of a Lumberjack And a Car who must Sink a Lumberjack in A Baloon Factory'),
    release_year: num(2006),
    language: str('English'),
    rental_duration: num(7),
    rental_rate: dbl(2.99),
    length: num(50),
    replacement_cost: dbl(18.99),
    rating: str('NC-17'),
    special_features: arr(str('Trailers'), str('Deleted Scenes')),
    category: str('Documentary'),
  });

  // Collection: actors
  await post('actors', 'actor_1', {
    first_name: str('PENELOPE'),
    last_name: str('GUINESS'),
    film_count: num(19),
  });

  await post('actors', 'actor_2', {
    first_name: str('NICK'),
    last_name: str('WAHLBERG'),
    film_count: num(25),
  });

  await post('actors', 'actor_3', {
    first_name: str('ED'),
    last_name: str('CHASE'),
    film_count: num(22),
  });

  // Collection: customers
  await post('customers', 'customer_1', {
    first_name: str('MARY'),
    last_name: str('SMITH'),
    email: str('MARY.SMITH@sakilacustomer.org'),
    active: bool(true),
    address: map({
      street: str('1913 Hanoi Way'),
      city: str('Sasebo'),
      country: str('Japan'),
      postal_code: str('35200'),
    }),
    created_at: ts('2006-02-14T22:04:36Z'),
  });

  await post('customers', 'customer_2', {
    first_name: str('PATRICIA'),
    last_name: str('JOHNSON'),
    email: str('PATRICIA.JOHNSON@sakilacustomer.org'),
    active: bool(true),
    address: map({
      street: str('1121 Loja Avenue'),
      city: str('San Bernardino'),
      country: str('United States'),
      postal_code: str('17886'),
    }),
    created_at: ts('2006-02-14T22:04:36Z'),
  });

  // Collection: rentals
  await post('rentals', 'rental_1', {
    rental_date: ts('2005-05-24T22:54:33Z'),
    customer_id: str('customer_1'),
    film_id: str('film_1'),
    return_date: ts('2005-05-28T19:40:33Z'),
    staff_id: str('staff_1'),
  });

  await post('rentals', 'rental_2', {
    rental_date: ts('2005-05-24T23:03:39Z'),
    customer_id: str('customer_2'),
    film_id: str('film_2'),
    return_date: ts('2005-06-01T22:12:39Z'),
    staff_id: str('staff_1'),
  });

  // Subcollection example: films/film_1/reviews
  await post('films/film_1/reviews', 'review_1', {
    author: str('MARY SMITH'),
    rating: num(5),
    comment: str('An absolute classic, highly recommended!'),
    created_at: ts('2023-07-01T10:00:00Z'),
  });

  await post('films/film_1/reviews', 'review_2', {
    author: str('PATRICIA JOHNSON'),
    rating: num(4),
    comment: str('Great film but a bit long.'),
    created_at: ts('2023-07-02T14:30:00Z'),
  });

  // Auth users — match the customers seeded above plus an admin
  console.log('Seeding Auth users...');
  await clearAuthUsers();
  await createAuthUsers([
    { localId: 'user-mary',     email: 'mary.smith@sakilacustomer.org',       password: 'password123', displayName: 'Mary Smith',        emailVerified: true  },
    { localId: 'user-patricia', email: 'patricia.johnson@sakilacustomer.org', password: 'password123', displayName: 'Patricia Johnson',  emailVerified: true  },
    { localId: 'user-admin',    email: 'admin@bks-dev.example',               password: 'admin1234',   displayName: 'Admin User',        emailVerified: true  },
    { localId: 'user-disabled', email: 'disabled@bks-dev.example',            password: 'password123', displayName: 'Disabled User',     emailVerified: false, disabled: true },
  ]);

  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

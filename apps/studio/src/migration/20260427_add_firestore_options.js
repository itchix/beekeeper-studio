export default {
  name: "20260427_add_firestore_options",
  async run(runner) {
    const queries = [
      `ALTER TABLE saved_connection ADD COLUMN firestoreOptions text not null default '{}'`,
      `ALTER TABLE used_connection ADD COLUMN firestoreOptions text not null default '{}'`,
    ];
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      await runner.query(query);
    }
  },
};

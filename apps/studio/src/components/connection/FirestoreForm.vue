<template>
  <div class="firestore-form">
    <div class="alert alert-warning">
      <i class="material-icons">info</i>
      <span>
        Firestore support is in beta. Connect using a
        <a href="https://firebase.google.com/docs/admin/setup#initialize-sdk" target="_blank">service account</a>
        or Application Default Credentials.
      </span>
    </div>

    <!-- Authentication Method -->
    <div class="form-group">
      <label for="authType">Authentication Method</label>
      <select
        id="authType"
        class="form-control custom-select"
        v-model="authType"
      >
        <option v-for="t in authTypes" :key="t.value" :value="t.value">
          {{ t.name }}
        </option>
      </select>
    </div>

    <!-- Service Account JSON (direct paste) -->
    <div v-if="authType === 'serviceAccount'" class="form-group">
      <label for="serviceAccountJson">Service Account JSON</label>
      <textarea
        id="serviceAccountJson"
        class="form-control"
        v-model="serviceAccountJson"
        placeholder='Paste your service account JSON key here...'
        rows="6"
        style="font-family: monospace; font-size: 12px;"
      ></textarea>
      <small class="form-text text-muted">
        Paste the entire JSON key file contents. Get it from
        <a href="https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk" target="_blank">
          Firebase Console &rarr; Service Accounts
        </a>
      </small>
    </div>

    <!-- Service Account File Path -->
    <div v-if="authType === 'serviceAccount'" class="form-group">
      <label for="serviceAccountPath">Or: Service Account File Path</label>
      <input
        id="serviceAccountPath"
        type="text"
        class="form-control"
        v-model="serviceAccountPath"
        placeholder="/path/to/service-account-key.json"
      />
      <small class="form-text text-muted">
        Alternatively, provide the file path to your service account key JSON.
      </small>
    </div>

    <!-- Project ID (optional override) -->
    <div class="form-group">
      <label for="projectId">Project ID <small>(optional override)</small></label>
      <input
        id="projectId"
        type="text"
        class="form-control"
        v-model="projectId"
        placeholder="my-firestore-project"
      />
      <small class="form-text text-muted">
        Auto-detected from service account. Override if needed.
      </small>
    </div>

    <!-- Database ID (for named databases) -->
    <div class="form-group">
      <label for="databaseId">Database ID</label>
      <input
        id="databaseId"
        type="text"
        class="form-control"
        v-model="databaseId"
        placeholder="(default)"
      />
      <small class="form-text text-muted">
        Leave as <code>(default)</code> for the default database, or enter a named database ID.
      </small>
    </div>
  </div>
</template>

<script lang="ts">
import { FirestoreAuthType } from '@/lib/db/types'

export default {
  name: 'FirestoreForm',
  props: {
    config: {
      type: Object,
      required: true,
    },
    testing: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      authTypes: [
        { name: 'Service Account Key', value: FirestoreAuthType.ServiceAccount },
        { name: 'Application Default Credentials', value: FirestoreAuthType.ApplicationDefault },
      ],
    }
  },
  computed: {
    authType: {
      get() {
        return this.config.firestoreOptions?.authType || FirestoreAuthType.ServiceAccount
      },
      set(value) {
        this.$set(this.config, 'firestoreOptions', {
          ...this.config.firestoreOptions,
          authType: value,
        })
      },
    },
    serviceAccountJson: {
      get() {
        return this.config.firestoreOptions?.serviceAccountJson || ''
      },
      set(value) {
        this.$set(this.config, 'firestoreOptions', {
          ...this.config.firestoreOptions,
          serviceAccountJson: value,
        })
      },
    },
    serviceAccountPath: {
      get() {
        return this.config.firestoreOptions?.serviceAccountPath || ''
      },
      set(value) {
        this.$set(this.config, 'firestoreOptions', {
          ...this.config.firestoreOptions,
          serviceAccountPath: value,
        })
      },
    },
    projectId: {
      get() {
        return this.config.firestoreOptions?.projectId || ''
      },
      set(value) {
        this.$set(this.config, 'firestoreOptions', {
          ...this.config.firestoreOptions,
          projectId: value,
        })
      },
    },
    databaseId: {
      get() {
        return this.config.firestoreOptions?.databaseId || '(default)'
      },
      set(value) {
        this.$set(this.config, 'firestoreOptions', {
          ...this.config.firestoreOptions,
          databaseId: value,
        })
      },
    },
  },
  mounted() {
    // Initialize firestoreOptions if not present or empty
    if (!this.config.firestoreOptions || !this.config.firestoreOptions.authType) {
      this.$set(this.config, 'firestoreOptions', {
        authType: FirestoreAuthType.ServiceAccount,
        serviceAccountJson: '',
        serviceAccountPath: '',
        projectId: '',
        databaseId: '(default)',
      })
    }
  },
}
</script>

<style scoped>
.firestore-form .alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.firestore-form .alert i {
  font-size: 18px;
  margin-top: 2px;
}

.firestore-form .alert span {
  flex: 1;
}

.firestore-form textarea {
  resize: vertical;
}
</style>
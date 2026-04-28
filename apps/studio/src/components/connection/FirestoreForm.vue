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
      <label for="serviceAccountJson">
        Service Account JSON
        <small class="text-muted">(required if no file path)</small>
      </label>
      <textarea
        id="serviceAccountJson"
        class="form-control"
        v-model="serviceAccountJson"
        @input="onJsonInput"
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
      <label for="serviceAccountPath">
        Or: Service Account File Path
        <small class="text-muted">(required if no JSON above)</small>
      </label>
      <input
        id="serviceAccountPath"
        type="text"
        class="form-control"
        v-model="serviceAccountPath"
        @input="onPathInput"
        placeholder="/path/to/service-account-key.json"
      />
      <small class="form-text text-muted">
        Provide the file path to your service account key JSON. Filling this clears the JSON field above.
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
import { PropType } from 'vue'
import { FirestoreAuthType } from '@/lib/db/types'

function firestoreOption(key: string) {
  return {
    get(this: any) {
      const defaults: Record<string, string> = { databaseId: '(default)' }
      return this.config.firestoreOptions?.[key] ?? defaults[key] ?? ''
    },
    set(this: any, value: string) {
      this.$set(this.config, 'firestoreOptions', {
        ...this.config.firestoreOptions,
        [key]: value,
      })
    },
  }
}

export default {
  name: 'FirestoreForm',
  props: {
    config: {
      type: Object as PropType<any>,
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
        { name: 'Service Account Key',             value: FirestoreAuthType.ServiceAccount        },
        { name: 'Application Default Credentials', value: FirestoreAuthType.ApplicationDefault    },
      ],
    }
  },
  computed: {
    authType:           firestoreOption('authType'),
    serviceAccountJson: firestoreOption('serviceAccountJson'),
    serviceAccountPath: firestoreOption('serviceAccountPath'),
    projectId:          firestoreOption('projectId'),
    databaseId:         firestoreOption('databaseId'),
  },
  mounted() {
    if (!this.config.firestoreOptions?.authType) {
      this.$set(this.config, 'firestoreOptions', {
        authType:           FirestoreAuthType.ServiceAccount,
        serviceAccountJson: '',
        serviceAccountPath: '',
        projectId:          '',
        databaseId:         '(default)',
      })
    }
  },
  methods: {
    // Mutual exclusivity: filling JSON clears the file path
    onJsonInput() {
      if (this.serviceAccountJson?.trim()) {
        this.$set(this.config, 'firestoreOptions', {
          ...this.config.firestoreOptions,
          serviceAccountPath: '',
        })
      }
    },
    // Mutual exclusivity: filling file path clears the JSON
    onPathInput() {
      if (this.serviceAccountPath?.trim()) {
        this.$set(this.config, 'firestoreOptions', {
          ...this.config.firestoreOptions,
          serviceAccountJson: '',
        })
      }
    },
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
